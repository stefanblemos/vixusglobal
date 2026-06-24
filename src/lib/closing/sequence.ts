import { prisma } from "@/lib/db";
import { entityNames, ownerNameMatches } from "@/lib/ownership/reconcile";
import { looseNameMatch } from "@/lib/personal/reconcile";

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
export interface SeqNode {
  key: string;
  kind: "company" | "person";
  id: string;
  name: string;
  form: string | null; // tributação/forma (C_CORP, PARTNERSHIP, 1040…)
  finalPayer: boolean; // C-corp ou PF — não passa para cima
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
  const [companies, parties, ownerships, taxReturns, personalReturns, yearCloses] =
    await Promise.all([
      prisma.company.findMany({
        select: { id: true, legalName: true, tradeName: true, aliases: true, entityType: true },
      }),
      prisma.party.findMany({ where: { kind: "PERSON" }, select: { id: true, name: true } }),
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
        select: { companyId: true, year: true, taxTreatment: true, taxForm: true, k1sReceived: true },
      }),
      prisma.personalReturn.findMany({ select: { partyId: true, year: true, matchedName: true } }),
      prisma.yearClose.findMany({ select: { companyId: true, year: true } }),
    ]);

  const years = [
    ...new Set([...taxReturns.map((t) => t.year), ...personalReturns.map((p) => p.year)].filter((y): y is number => y != null)),
  ].sort((a, b) => b - a);

  const ck = (id: string) => `c:${id}`;
  const pk = (id: string) => `p:${id}`;
  const compById = new Map(companies.map((c) => [c.id, c]));

  // Forma/tributação por empresa (último IR conhecido). Pass-through = ≠ C_CORP.
  const treatByCompany = new Map<string, string>();
  for (const t of taxReturns.sort((a, b) => (a.year ?? 0) - (b.year ?? 0))) {
    if (t.companyId) treatByCompany.set(t.companyId, t.taxTreatment ?? t.taxForm ?? "");
  }
  const isCorp = (id: string) => /c.?corp|1120(?!-s)/i.test(treatByCompany.get(id) ?? "");

  // ── Nós ──
  const nodes = new Map<string, SeqNode>();
  for (const c of companies) {
    nodes.set(ck(c.id), {
      key: ck(c.id),
      kind: "company",
      id: c.id,
      name: c.legalName,
      form: treatByCompany.get(c.id) ?? null,
      finalPayer: isCorp(c.id),
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
      form: "1040",
      finalPayer: true,
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

  // 1) Ownership: o dono X só fecha depois da possuída Y (pass-through = K-1; C-corp = dividendo).
  //    Filtra só por SAÍDA (endDate ≤ fim do ano = já vendeu); ignora a data de ENTRADA, que nem
  //    sempre é confiável (manuais ficam com a data de cadastro) e quebraria a árvore.
  for (const r of ownerships) {
    if (r.endDate && r.endDate <= asOf) continue;
    if (!r.ownedCompanyId) continue; // só entidade fecha IR
    const xKey = r.ownerPartyId ? pk(r.ownerPartyId) : r.ownerCompanyId ? ck(r.ownerCompanyId) : null;
    if (xKey) addDep(xKey, ck(r.ownedCompanyId));
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
