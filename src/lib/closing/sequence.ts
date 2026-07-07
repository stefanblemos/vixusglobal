import { prisma } from "@/lib/db";
import { edgesFromOwnerships } from "@/lib/ownership/effective";
import { entityNames, ownerNameMatches } from "@/lib/ownership/reconcile";
import { looseNameMatch } from "@/lib/personal/reconcile";
import { buildTreatmentResolver, isCorpTreatment } from "@/lib/tax/treatment";

const SUFFIX = /^(llc|l\.l\.c|inc|corp|co|ltd|lp|llp|pa|the|and|of)$/i;
// Acrônimo curto p/ caber na tela (token com dígito é o mais identificador; sigla em CAIXA
// já pronta é mantida; senão, iniciais das palavras significativas).
export function acronymOf(name: string, kind: "company" | "person"): string {
  if (kind === "person") {
    const ini = name.split(/\s+/).filter((w) => /[a-z]/i.test(w)).map((w) => w[0].toUpperCase()).join("");
    return ini.slice(0, 3) || name.slice(0, 2).toUpperCase();
  }
  const tokens = name.replace(/[.,&]/g, " ").split(/\s+/).filter(Boolean).filter((w) => !SUFFIX.test(w));
  const numTok = tokens.find((w) => /\d/.test(w));
  if (numTok) return numTok.toUpperCase().slice(0, 6);
  const upper = tokens.find((w) => w.length >= 2 && w === w.toUpperCase());
  if (upper) return upper.slice(0, 5);
  return tokens.map((w) => w[0].toUpperCase()).join("").slice(0, 4) || name.slice(0, 3).toUpperCase();
}

// Sequência de fechamento do IR seguindo a árvore pass-through: cada entidade só pode
// fechar DEPOIS das investidas que lhe emitem K-1 (senão a renda do K-1 some). A ordem é
// uma ordenação topológica das dependências (investida → investidora). C-corp e PF são
// pagadores finais (não passam para cima); a PF (1040) é o topo.

export type SeqStatus = "done" | "ready" | "blocked";

export interface SeqDep {
  key: string;
  name: string;
  done: boolean;
}
export interface SeqRecipient {
  name: string;
  acronym: string;
  pct: number;
}
export interface SeqNode {
  key: string;
  kind: "company" | "person";
  id: string;
  name: string;
  acronym: string;
  form: string | null; // tributação/forma (C_CORP, PARTNERSHIP, 1040…)
  finalPayer: boolean; // C-corp ou PF — não passa para cima
  passesTo: SeqRecipient[]; // donos que recebem a renda desta entidade (com %)
  tier: number; // 1..N (0 = ciclo / não resolvido)
  deps: SeqDep[];
  status: SeqStatus;
  done: boolean;
  outOfOrder: string[]; // investidas ainda abertas, apesar desta já estar fechada
  inCycle: boolean;
}
export interface ClosingSequence {
  year: number;
  years: number[];
  tiers: SeqNode[][];
  nextUp: SeqNode[];
  outOfOrder: SeqNode[];
}

export async function buildClosingSequence(year: number): Promise<ClosingSequence> {
  const asOf = new Date(Date.UTC(year, 11, 31));
  const [companies, parties, ownerships, taxReturns, personalReturns, yearCloses, taxStatuses] =
    await Promise.all([
      // Só entra na sequência quem está no escopo do fechamento: grupo + geridas cujo IR
      // tomamos conta (controlsTax). Mesmo filtro do "closing completeness" — as duas telas batem.
      // Quem não controlamos (ex.: monitored=false, ou pessoa externa) some, e o contador não
      // pensa que pedimos o IR delas. Trocar o flag em Edit (empresa) / na ficha (pessoa) ajusta.
      prisma.company.findMany({
        // Entidade desconsiderada (disregarded) NÃO declara IR próprio (é consolidada no da dona) → não
        // é um passo do fechamento nem cria dependência para a dona (a posse 100% não gera K-1 a esperar).
        where: { monitored: true, disregardedIntoId: null, OR: [{ relationship: "GROUP_MEMBER" }, { controlsTax: true }] },
        select: { id: true, legalName: true, tradeName: true, aliases: true, entityType: true },
      }),
      prisma.party.findMany({
        where: { kind: "PERSON", controlsTax: true },
        select: { id: true, name: true },
      }),
      prisma.ownership.findMany({
        select: {
          ownerCompanyId: true,
          ownerPartyId: true,
          ownedCompanyId: true,
          ownedPartyId: true,
          percentage: true,
          effectiveDate: true,
          endDate: true,
        },
      }),
      prisma.taxReturn.findMany({
        where: { companyId: { not: null } },
        select: { companyId: true, year: true, taxTreatment: true, taxForm: true, k1sReceived: true, createdAt: true },
      }),
      prisma.personalReturn.findMany({ select: { partyId: true, year: true, matchedName: true } }),
      prisma.yearClose.findMany({ select: { companyId: true, year: true } }),
      prisma.companyTaxStatus.findMany({ select: { companyId: true, year: true, taxTreatment: true } }),
    ]);

  const years = [
    ...new Set([...taxReturns.map((t) => t.year), ...personalReturns.map((p) => p.year)].filter((y): y is number => y != null)),
  ].sort((a, b) => b - a);

  const ck = (id: string) => `c:${id}`;
  const pk = (id: string) => `p:${id}`;
  const compById = new Map(companies.map((c) => [c.id, c]));

  // Forma/tributação por (empresa, ano do fechamento) — resolver único: cadastro do ano > IR do
  // ano > último conhecido. Alimenta o IR com taxTreatment ?? taxForm p/ preservar a detecção 1120.
  const resolveTreatment = buildTreatmentResolver(
    taxStatuses,
    taxReturns
      .filter((t) => t.companyId && t.year != null)
      .map((t) => ({
        companyId: t.companyId!,
        year: t.year!,
        taxTreatment: t.taxTreatment ?? t.taxForm ?? null,
        createdAt: t.createdAt,
      })),
  );
  const treatOf = (id: string) => resolveTreatment(id, year).treatment;
  const isCorp = (id: string) => isCorpTreatment(treatOf(id));

  // ── Nós ──
  const nodes = new Map<string, SeqNode>();
  for (const c of companies) {
    nodes.set(ck(c.id), {
      key: ck(c.id),
      kind: "company",
      id: c.id,
      name: c.legalName,
      acronym: acronymOf(c.legalName, "company"),
      form: treatOf(c.id),
      finalPayer: isCorp(c.id),
      passesTo: [],
      tier: 0,
      deps: [],
      status: "blocked",
      done: false,
      outOfOrder: [],
      inCycle: false,
    });
  }
  for (const pt of parties) {
    nodes.set(pk(pt.id), {
      key: pk(pt.id),
      kind: "person",
      id: pt.id,
      name: pt.name,
      acronym: acronymOf(pt.name, "person"),
      form: "1040",
      finalPayer: true,
      passesTo: [],
      tier: 0,
      deps: [],
      status: "blocked",
      done: false,
      outOfOrder: [],
      inCycle: false,
    });
  }

  // ── Dependências (investida Y → investidora X: X depende de Y) ──
  const deps = new Map<string, Set<string>>();
  const addDep = (xKey: string, yKey: string) => {
    if (xKey === yKey || !nodes.has(xKey) || !nodes.has(yKey)) return;
    (deps.get(xKey) ?? deps.set(xKey, new Set()).get(xKey)!).add(yKey);
  };

  // 1) Ownership VIGENTE no ano (effectiveDate ≤ 31/12 e ainda não saiu): o dono X só fecha
  //    depois da possuída Y (pass-through = K-1; C-corp = dividendo). Trocar o dono daquele ano
  //    no cadastro reflete aqui. Também alimenta "passa para" (Y → seus donos, com %).
  const passesToMap = new Map<string, { key: string; pct: number }[]>();
  for (const e of edgesFromOwnerships(ownerships, asOf)) {
    if (e.ownedType !== "company") continue;
    const xKey = e.ownerType === "party" ? pk(e.ownerId) : ck(e.ownerId);
    const yKey = ck(e.ownedId);
    addDep(xKey, yKey);
    if (nodes.has(xKey) && nodes.has(yKey))
      (passesToMap.get(yKey) ?? passesToMap.set(yKey, []).get(yKey)!).push({ key: xKey, pct: e.percentage });
  }

  // 2) K-1 declarados no IR (autêntico): X recebeu K-1 de Y → X depende de Y.
  const named = companies.map((c) => ({ id: c.id, names: entityNames(c) }));
  for (const t of taxReturns) {
    if (t.companyId == null || t.year !== year) continue;
    const k1 = (t.k1sReceived as { issuerName: string }[] | null) ?? [];
    for (const k of k1) {
      const issuer = named.find((n) => ownerNameMatches(n.names, k.issuerName));
      if (issuer) addDep(ck(t.companyId), ck(issuer.id));
    }
  }

  // ── "Fechado" (done) ──
  const irYears = new Set(taxReturns.filter((t) => t.year === year).map((t) => t.companyId));
  const lockedYears = new Set(yearCloses.filter((y) => y.year === year).map((y) => y.companyId));
  const prByParty = personalReturns.filter((p) => p.year === year);
  const isDone = (n: SeqNode) => {
    if (n.kind === "company") return irYears.has(n.id) || lockedYears.has(n.id);
    const party = parties.find((p) => p.id === n.id);
    return prByParty.some((r) => r.partyId === n.id || (r.matchedName && party && looseNameMatch(party.name, r.matchedName)));
  };
  for (const n of nodes.values()) n.done = isDone(n);

  // ── Tier via ordenação topológica iterativa ──
  const tierOf = new Map<string, number>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [key] of nodes) {
      if (tierOf.has(key)) continue;
      const d = [...(deps.get(key) ?? [])];
      if (d.every((y) => tierOf.has(y))) {
        tierOf.set(key, d.length ? 1 + Math.max(...d.map((y) => tierOf.get(y)!)) : 1);
        changed = true;
      }
    }
  }

  // ── Preenche cada nó ──
  for (const n of nodes.values()) {
    n.passesTo = (passesToMap.get(n.key) ?? [])
      .map((r) => ({ name: nodes.get(r.key)!.name, acronym: nodes.get(r.key)!.acronym, pct: r.pct }))
      .sort((a, b) => b.pct - a.pct);
    const d = [...(deps.get(n.key) ?? [])];
    n.deps = d.map((y) => ({ key: y, name: nodes.get(y)!.name, done: nodes.get(y)!.done })).sort((a, b) => a.name.localeCompare(b.name));
    n.inCycle = !tierOf.has(n.key);
    n.tier = tierOf.get(n.key) ?? 0;
    const openDeps = n.deps.filter((x) => !x.done);
    n.status = n.done ? "done" : openDeps.length === 0 ? "ready" : "blocked";
    if (n.done) n.outOfOrder = openDeps.map((x) => x.name);
  }

  // ── Agrupa em tiers (descarta nós isolados sem relação nem IR para reduzir ruído) ──
  const relevant = [...nodes.values()].filter(
    (n) => n.deps.length > 0 || [...deps.values()].some((s) => s.has(n.key)) || n.done,
  );
  const maxTier = Math.max(1, ...relevant.map((n) => n.tier));
  const tiers: SeqNode[][] = [];
  for (let t = 0; t <= maxTier; t++) {
    const inTier = relevant.filter((n) => n.tier === t).sort((a, b) => a.name.localeCompare(b.name));
    if (inTier.length) tiers.push(inTier);
  }

  const nextUp = relevant.filter((n) => n.status === "ready").sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name));
  const outOfOrder = relevant.filter((n) => n.outOfOrder.length > 0);

  return { year, years, tiers, nextUp, outOfOrder };
}
