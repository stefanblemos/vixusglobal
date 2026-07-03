import { prisma } from "@/lib/db";
import { pnlTotals } from "@/lib/qbo/pnl";
import { matchCompany } from "@/lib/qbo/match";
import { extractPositions, reconcile } from "@/lib/qbo/reconcile";
import { loadRatesAsOf, toUsd } from "@/lib/fx/rates";
import { periodMonths } from "@/lib/qbo/period";

// CONSOLIDAÇÃO DO GRUPO (v1, transparente): agrega os financeiros das empresas do grupo (só USD) e
// ELIMINA a dívida intercompany que a reconciliação já CONFIRMA (os dois lados batem). O que não dá
// para eliminar limpo hoje (investimento em coligada, renda intercompany) fica à mostra num
// "worksheet a conferir" — e vira exato conforme as empresas adotam o plano de contas canônico
// (contas 1200/2200/1800/4950 dedicadas). Não escondo o que não fecha.

export interface CompanyRollup {
  companyId: string;
  name: string;
  hasBS: boolean;
  hasPL: boolean;
  assets: number | null;
  liabilities: number | null;
  equity: number | null;
  revenue: number | null;
  netIncome: number | null;
}

export interface EliminationRow {
  creditor: string;
  debtor: string;
  amount: number; // USD eliminado (lado que bate)
  status: "confirmado" | "a-conferir";
  note: string;
}

export interface Consolidation {
  year: number;
  years: number[];
  companies: CompanyRollup[];
  gross: { assets: number; liabilities: number; equity: number; revenue: number; netIncome: number };
  intercompanyEliminated: number; // dívida intercompany confirmada (reduz ativo e passivo)
  consolidated: { assets: number; liabilities: number; equity: number; revenue: number; netIncome: number };
  eliminations: EliminationRow[];
  flaggedCount: number; // posições intercompany que NÃO fecham (a conferir)
  excludedForeign: string[]; // entidades em moeda estrangeira, fora da consolidação USD
  missingData: string[]; // empresas do grupo sem BS/P&L do ano
}

const yearOf = (s: string | null | undefined) => Number((String(s ?? "").match(/(?:19|20)\d\d/) ?? [])[0] ?? 0);
const bsSubject = (label: string) => {
  const m = label.match(/^total\s+(?:(?:for|para|do|da|de)\s+)?(.+)$/i);
  return (m?.[1] ?? label.replace(/^total\s+/i, "")).trim().toLowerCase();
};

type Imp = { periodLabel: string | null; lines: { label: string; lineType: string; sectionPath: string[]; value: unknown; currency: string }[] };

function pickForYear(imps: Imp[], year: number): Imp | null {
  const inYear = imps.filter((i) => yearOf(i.periodLabel) === year);
  if (!inYear.length) return null;
  // maior cobertura de período (fim mais tarde) → o mais próximo do ano cheio / fim de ano
  return inYear.sort((a, b) => (periodMonths(b.periodLabel ?? "")?.end ?? 12) - (periodMonths(a.periodLabel ?? "")?.end ?? 12))[0];
}

export async function buildConsolidation(year: number): Promise<Consolidation> {
  const companies = await prisma.company.findMany({
    where: { monitored: true },
    select: { id: true, legalName: true, tradeName: true, aliases: true, baseCurrency: true },
    orderBy: { legalName: "asc" },
  });
  const nameOf = (id: string) => companies.find((c) => c.id === id)?.legalName ?? "—";
  const usd = companies.filter((c) => (c.baseCurrency ?? "USD") === "USD");
  const excludedForeign = companies.filter((c) => (c.baseCurrency ?? "USD") !== "USD").map((c) => c.legalName);

  const [bsImports, plImports] = await Promise.all([
    prisma.qboImport.findMany({
      where: { reportKind: "BALANCE_SHEET", companyId: { in: usd.map((c) => c.id) } },
      orderBy: { createdAt: "desc" },
      select: { companyId: true, periodLabel: true, lines: { select: { label: true, lineType: true, sectionPath: true, value: true, currency: true } } },
    }),
    prisma.qboImport.findMany({
      where: { reportKind: "PROFIT_AND_LOSS", companyId: { in: usd.map((c) => c.id) } },
      orderBy: { createdAt: "desc" },
      select: { companyId: true, periodLabel: true, lines: { select: { label: true, lineType: true, value: true } } },
    }),
  ]);
  const bsByCo = new Map<string, Imp[]>();
  for (const b of bsImports) { const a = bsByCo.get(b.companyId!) ?? []; a.push(b as Imp); bsByCo.set(b.companyId!, a); }
  const plByCo = new Map<string, typeof plImports>();
  for (const p of plImports) { const a = plByCo.get(p.companyId!) ?? []; a.push(p); plByCo.set(p.companyId!, a); }

  const years = [...new Set([...bsImports, ...plImports].map((i) => yearOf(i.periodLabel)).filter(Boolean))].sort((a, b) => b - a);

  const rollups: CompanyRollup[] = [];
  const missingData: string[] = [];
  for (const c of usd) {
    const bs = pickForYear(bsByCo.get(c.id) ?? [], year);
    const plImps = (plByCo.get(c.id) ?? []).filter((p) => yearOf(p.periodLabel) === year);
    const annual = plImps.find((p) => /(?:january|janeiro)[\s\S]*(?:december|dezembro)/i.test(p.periodLabel ?? "")) ?? plImps[0];
    const bsTotal = (key: string) => {
      const l = bs?.lines.find((x) => x.lineType === "TOTAL" && bsSubject(x.label) === key);
      return l?.value != null ? Number(l.value) : null;
    };
    const pl = annual ? pnlTotals(annual.lines) : null;
    if (!bs && !annual) missingData.push(c.legalName);
    rollups.push({
      companyId: c.id, name: c.legalName, hasBS: !!bs, hasPL: !!annual,
      assets: bsTotal("assets"), liabilities: bsTotal("liabilities"), equity: bsTotal("equity"),
      revenue: pl?.revenue ?? null, netIncome: pl?.netIncome ?? null,
    });
  }

  const sum = (f: (r: CompanyRollup) => number | null) => Math.round(rollups.reduce((s, r) => s + (f(r) ?? 0), 0) * 100) / 100;
  const gross = { assets: sum((r) => r.assets), liabilities: sum((r) => r.liabilities), equity: sum((r) => r.equity), revenue: sum((r) => r.revenue), netIncome: sum((r) => r.netIncome) };

  // Eliminação intercompany: posições do BS do ANO, casadas entre empresas do grupo (reconcile).
  const resolve = (nm: string) => matchCompany(nm, companies);
  const rates = await loadRatesAsOf(new Date());
  const bsForYear: { companyId: string; imp: Imp }[] = [];
  for (const c of usd) {
    const imp = pickForYear(bsByCo.get(c.id) ?? [], year);
    if (imp) bsForYear.push({ companyId: c.id, imp });
  }
  const positions = bsForYear
    .flatMap(({ companyId, imp }) =>
      extractPositions(
        companyId,
        imp.lines.map((l) => ({ label: l.label, lineType: l.lineType, sectionPath: l.sectionPath, amount: l.value?.toString() ?? null })),
        resolve,
        imp.lines[0]?.currency ?? "USD",
      ),
    )
    .map((p) => ({ ...p, amount: toUsd(p.amount, p.currency, rates) }));
  const recon = reconcile(positions);

  const eliminations: EliminationRow[] = [];
  let intercompanyEliminated = 0;
  let flaggedCount = 0;
  for (const r of recon) {
    if (r.status === "RECONCILED") {
      const amt = Math.round(((r.creditorAmount ?? r.debtorAmount ?? 0)) * 100) / 100;
      intercompanyEliminated += amt;
      eliminations.push({ creditor: nameOf(r.creditorId), debtor: nameOf(r.debtorId), amount: amt, status: "confirmado", note: "dívida intercompany — os dois lados batem" });
    } else {
      flaggedCount++;
      eliminations.push({
        creditor: nameOf(r.creditorId), debtor: nameOf(r.debtorId),
        amount: Math.round(((r.creditorAmount ?? r.debtorAmount ?? 0)) * 100) / 100,
        status: "a-conferir",
        note: r.status === "MISMATCH" ? `os dois lados divergem (Δ ${Math.round(r.diff).toLocaleString("en-US")})` : "só um lado reportou",
      });
    }
  }
  intercompanyEliminated = Math.round(intercompanyEliminated * 100) / 100;
  eliminations.sort((a, b) => (a.status === b.status ? b.amount - a.amount : a.status === "a-conferir" ? -1 : 1));

  const consolidated = {
    assets: Math.round((gross.assets - intercompanyEliminated) * 100) / 100,
    liabilities: Math.round((gross.liabilities - intercompanyEliminated) * 100) / 100,
    equity: gross.equity,
    revenue: gross.revenue,
    netIncome: gross.netIncome,
  };

  return { year, years, companies: rollups, gross, intercompanyEliminated, consolidated, eliminations, flaggedCount, excludedForeign, missingData };
}

// Série temporal: métricas-cabeça por ano (para o gráfico de trajetória). Reusa o mesmo roll-up.
export interface ConsolidationPoint { year: number; netIncome: number; assets: number; equity: number; intercompanyEliminated: number }
export async function buildConsolidationSeries(years: number[]): Promise<ConsolidationPoint[]> {
  const out: ConsolidationPoint[] = [];
  for (const y of years) {
    const c = await buildConsolidation(y);
    out.push({ year: y, netIncome: c.consolidated.netIncome, assets: c.consolidated.assets, equity: c.consolidated.equity, intercompanyEliminated: c.intercompanyEliminated });
  }
  return out.sort((a, b) => a.year - b.year);
}
