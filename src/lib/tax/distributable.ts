import { prisma } from "@/lib/db";
import { loadTreatmentResolver, isCorpTreatment } from "@/lib/tax/treatment";
import { isEffectiveAt, asOfYearEnd } from "@/lib/ownership/effective";
import { effectiveFiguresOf } from "@/lib/ir/figures";

// BASE DISTRIBUÍVEL (renda já tributada) — quanto dá para mover de uma pass-through ao DESTINO FINAL
// sem novo imposto. Fonte = IR (não os livros): a `capital account (end)` da última declaração ≤ ano
// é a BASE fiscal distribuível (distribuição até a base = devolução de renda já tributada, tax-free;
// acima vira ganho). Valor BRUTO (o imposto já foi pago no ano da renda; distribuir não gera imposto
// novo). Atribuição SEM dupla contagem: a base de cada pass-through vai só aos donos diretos que são
// FINAIS (pessoa ou C-corp); dono pass-through é conduíte (a capital account dele já rola o de baixo).
// Guarda: pass-through sem IR (ou sem a figura) → NÃO calcula, sinaliza.

const num = (v: unknown) => Number((v as { toString(): string } | null)?.toString() ?? 0);
const r2 = (n: number) => Math.round(n * 100) / 100;
// "Partners'/Members' capital accounts (end of year)" no Schedule L / M-2.
const CAPITAL_END = /(partner|member).*capital.*end|capital account.*end/i;

export interface DistSource {
  companyId: string;
  name: string;
  pct: number;
  capitalAccount: number; // base fiscal (end) da declaração usada
  irYear: number; // ano da declaração de onde veio a base (as-of)
  amount: number; // capitalAccount × pct
}

export interface DistOwner {
  key: string;
  kind: "pessoa" | "C-corp";
  name: string;
  total: number;
  sources: DistSource[]; // pass-throughs de origem (detalhe)
}

export interface DistMissing {
  companyId: string;
  name: string;
  reason: "sem-ir" | "ir-sem-figura"; // sem declaração ≤ ano, ou tem mas sem a figura capital account
}

export interface DistributableReport {
  year: number;
  owners: DistOwner[];
  missing: DistMissing[];
  total: number;
}

export async function buildDistributableReport(year: number): Promise<DistributableReport> {
  const asOf = asOfYearEnd(year);
  const [companies, parties, owns, resolve] = await Promise.all([
    prisma.company.findMany({ select: { id: true, legalName: true } }),
    prisma.party.findMany({ where: { kind: "PERSON" }, select: { id: true, name: true } }),
    prisma.ownership.findMany({
      select: { ownerPartyId: true, ownerCompanyId: true, ownedCompanyId: true, percentage: true, effectiveDate: true, endDate: true },
    }),
    loadTreatmentResolver(),
  ]);
  const nameCo = new Map(companies.map((c) => [c.id, c.legalName]));
  const nameP = new Map(parties.map((p) => [p.id, p.name]));
  const isCorp = (id: string) => isCorpTreatment(resolve(id, year).treatment);

  // capital account (end) da ÚLTIMA declaração ≤ ano de cada empresa + quais empresas têm IR.
  const returns = await prisma.taxReturn.findMany({ where: { companyId: { not: null } }, orderBy: { year: "asc" } });
  const hasIr = new Set<string>();
  const capByCo = new Map<string, { val: number; year: number }>();
  for (const ret of returns) {
    if (!ret.companyId || ret.year == null || ret.year > year) continue;
    hasIr.add(ret.companyId);
    const figs = (effectiveFiguresOf(ret) ?? []) as { label?: string; value?: number | null }[];
    const cap = figs.find((f) => CAPITAL_END.test(f.label ?? ""))?.value;
    if (cap != null) capByCo.set(ret.companyId, { val: Math.abs(num(cap)), year: ret.year }); // sort asc → fica o mais recente
  }

  const pool = new Map<string, DistOwner>();
  const missing: DistMissing[] = [];
  const addTo = (key: string, name: string, kind: "pessoa" | "C-corp", src: DistSource) => {
    const g = pool.get(key) ?? { key, kind, name, total: 0, sources: [] };
    g.total = r2(g.total + src.amount);
    g.sources.push(src);
    pool.set(key, g);
  };

  for (const e of companies) {
    if (isCorp(e.id)) continue; // C-corp não é origem (pagadora final, para nela)
    const ownersOfE = owns.filter((o) => o.ownedCompanyId === e.id && isEffectiveAt(o, asOf));
    if (!ownersOfE.length) continue; // sem ownership → fora
    const cap = capByCo.get(e.id);
    if (!cap) {
      missing.push({ companyId: e.id, name: nameCo.get(e.id) ?? "—", reason: hasIr.has(e.id) ? "ir-sem-figura" : "sem-ir" });
      continue;
    }
    for (const o of ownersOfE) {
      const pct = Number(o.percentage);
      const src: DistSource = {
        companyId: e.id, name: nameCo.get(e.id) ?? "—", pct,
        capitalAccount: cap.val, irYear: cap.year, amount: r2((cap.val * pct) / 100),
      };
      if (o.ownerPartyId) addTo(`P:${o.ownerPartyId}`, nameP.get(o.ownerPartyId) ?? "?", "pessoa", src);
      else if (o.ownerCompanyId && isCorp(o.ownerCompanyId)) addTo(`C:${o.ownerCompanyId}`, nameCo.get(o.ownerCompanyId) ?? "?", "C-corp", src);
      // dono pass-through → conduíte, pula (a base dele já rola esta)
    }
  }

  const owners = [...pool.values()]
    .map((o) => ({ ...o, sources: o.sources.sort((a, b) => b.amount - a.amount) }))
    .sort((a, b) => b.total - a.total);
  return {
    year,
    owners,
    missing: missing.sort((a, b) => a.name.localeCompare(b.name)),
    total: r2(owners.reduce((s, o) => s + o.total, 0)),
  };
}
