import { prisma } from "@/lib/db";
import { pnlTotals } from "@/lib/qbo/pnl";
import { qboPeriodKey } from "@/lib/qbo/period";

export const GLOBAL_RATE_KEY = "GLOBAL";
const DEFAULT_RATE = 30;

const yearOf = (label: string): number | null => {
  const m = label.match(/(20\d\d)/);
  return m ? Number(m[1]) : null;
};
// P&L anual cobre o ano todo ("January-December" / "janeiro-dezembro"); senão é mensal.
const isAnnual = (label: string) => /(?:january|janeiro)[\s\S]*(?:december|dezembro)/i.test(label);

type Pnl = { id: string; periodLabel: string };

async function netIncomeOf(importId: string): Promise<number | null> {
  const lines = await prisma.qboImportLine.findMany({
    where: { importId, lineType: "TOTAL" },
  });
  return pnlTotals(lines).netIncome;
}

async function rateConfig() {
  const rates = await prisma.taxReserveRate.findMany();
  const global = Number(
    rates.find((r) => r.companyId === GLOBAL_RATE_KEY)?.ratePct ?? DEFAULT_RATE,
  );
  const override = new Map(
    rates
      .filter((r) => r.companyId !== GLOBAL_RATE_KEY)
      .map((r) => [r.companyId, Number(r.ratePct)]),
  );
  return { global, override };
}

// Lucro do ano: usa o P&L anual se houver; senão soma os meses daquele ano.
async function profitForYear(pnls: Pnl[], year: number) {
  const inYear = pnls.filter((p) => yearOf(p.periodLabel) === year);
  if (!inYear.length) return { profit: null as number | null, periodLabel: null, importId: null };

  const annual = inYear
    .filter((p) => isAnnual(p.periodLabel))
    .sort((a, b) => qboPeriodKey(b.periodLabel) - qboPeriodKey(a.periodLabel));
  if (annual.length) {
    return {
      profit: await netIncomeOf(annual[0].id),
      periodLabel: annual[0].periodLabel,
      importId: annual[0].id as string | null,
    };
  }
  let sum = 0;
  let any = false;
  for (const p of inYear) {
    const ni = await netIncomeOf(p.id);
    if (ni != null) {
      sum += ni;
      any = true;
    }
  }
  return {
    profit: any ? sum : null,
    periodLabel: inYear.length === 1 ? inYear[0].periodLabel : `${inYear.length} months · ${year}`,
    importId: inYear.length === 1 ? inYear[0].id : null,
  };
}

// Anos que têm algum P&L (para o seletor).
export async function reserveYears(): Promise<number[]> {
  const pnls = await prisma.qboImport.findMany({
    where: { reportKind: "PROFIT_AND_LOSS", companyId: { not: null } },
    select: { periodLabel: true },
  });
  const ys = new Set<number>();
  for (const p of pnls) {
    const y = yearOf(p.periodLabel);
    if (y) ys.add(y);
  }
  return [...ys].sort((a, b) => b - a);
}

export type ReserveRow = {
  companyId: string;
  name: string;
  currency: string;
  periodLabel: string | null;
  importId: string | null;
  profit: number | null;
  ratePct: number;
  hasOverride: boolean;
  reserve: number;
};

// Provisão de IR de todas as empresas para um ANO.
export async function buildTaxReserve(year: number): Promise<{ rows: ReserveRow[] }> {
  const [companies, pnls, { global, override }] = await Promise.all([
    prisma.company.findMany({ select: { id: true, legalName: true, baseCurrency: true } }),
    prisma.qboImport.findMany({
      where: { reportKind: "PROFIT_AND_LOSS", companyId: { not: null } },
      select: { id: true, companyId: true, periodLabel: true },
    }),
    rateConfig(),
  ]);

  const byCompany = new Map<string, Pnl[]>();
  for (const p of pnls) {
    if (!p.companyId) continue;
    const arr = byCompany.get(p.companyId) ?? [];
    arr.push({ id: p.id, periodLabel: p.periodLabel });
    byCompany.set(p.companyId, arr);
  }

  const rows: ReserveRow[] = [];
  for (const c of companies) {
    const cp = byCompany.get(c.id);
    if (!cp) continue;
    const { profit, periodLabel, importId } = await profitForYear(cp, year);
    if (periodLabel == null) continue; // sem P&L nesse ano
    const hasOverride = override.has(c.id);
    const ratePct = hasOverride ? override.get(c.id)! : global;
    const reserve = profit != null && profit > 0 ? (profit * ratePct) / 100 : 0;
    rows.push({
      companyId: c.id,
      name: c.legalName,
      currency: c.baseCurrency,
      periodLabel,
      importId,
      profit,
      ratePct,
      hasOverride,
      reserve,
    });
  }
  rows.sort((a, b) => b.reserve - a.reserve);
  return { rows };
}

// Estimativa de IR de UMA empresa num ano — para a aba da empresa.
export async function companyReserve(companyId: string, year: number) {
  const [pnls, { global, override }] = await Promise.all([
    prisma.qboImport.findMany({
      where: { companyId, reportKind: "PROFIT_AND_LOSS" },
      select: { id: true, periodLabel: true },
    }),
    rateConfig(),
  ]);
  const { profit, periodLabel, importId } = await profitForYear(pnls, year);
  const hasOverride = override.has(companyId);
  const ratePct = hasOverride ? override.get(companyId)! : global;
  const reserve = profit != null && profit > 0 ? (profit * ratePct) / 100 : 0;
  return { profit, periodLabel, importId, ratePct, hasOverride, reserve };
}
