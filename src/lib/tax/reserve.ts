import { prisma } from "@/lib/db";
import { pnlTotals } from "@/lib/qbo/pnl";
import { qboPeriodKey } from "@/lib/qbo/period";
import { buildAssetRegister } from "@/lib/assets/depreciation";

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

// Depreciação contábil (book) lançada no P&L — para "estornar" e trocar pela fiscal (MACRS).
async function bookDepreciationOf(importIds: string[]): Promise<number> {
  if (importIds.length === 0) return 0;
  const lines = await prisma.qboImportLine.findMany({
    where: { importId: { in: importIds }, lineType: "ACCOUNT" },
    select: { label: true, value: true },
  });
  let sum = 0;
  for (const l of lines) {
    if (l.value != null && /depreciat|amortiz|deprecia[cç]/i.test(l.label)) sum += Number(l.value);
  }
  return Math.round(sum * 100) / 100;
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
  if (!inYear.length)
    return { profit: null as number | null, periodLabel: null, importId: null, importIds: [] as string[] };

  const annual = inYear
    .filter((p) => isAnnual(p.periodLabel))
    .sort((a, b) => qboPeriodKey(b.periodLabel) - qboPeriodKey(a.periodLabel));
  if (annual.length) {
    return {
      profit: await netIncomeOf(annual[0].id),
      periodLabel: annual[0].periodLabel,
      importId: annual[0].id as string | null,
      importIds: [annual[0].id],
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
    importIds: inYear.map((p) => p.id),
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

export type ReserveOwner = { name: string; pct: number; attributed: number };

export type ReserveRow = {
  companyId: string;
  name: string;
  currency: string;
  periodLabel: string | null;
  importId: string | null;
  profit: number | null; // lucro contábil (book) do P&L
  bookDep: number; // depreciação contábil lançada no P&L
  taxDep: number; // depreciação fiscal calculada (MACRS)
  hasAssets: boolean; // há ativos cadastrados p/ ajustar?
  depAdjustment: number; // book − tax (entra no lucro tributável)
  taxableProfit: number | null; // lucro ajustado
  ratePct: number;
  hasOverride: boolean;
  reserve: number;
  owners: ReserveOwner[]; // para quem o lucro flui (ownership direto)
};

export type OwnerFlow = { name: string; total: number; from: { company: string; amount: number }[] };

// Provisão de IR de todas as empresas para um ANO — com ajuste de depreciação (book→fiscal)
// e o fluxo de lucro para os donos (ownership direto).
export async function buildTaxReserve(
  year: number,
): Promise<{ rows: ReserveRow[]; flow: OwnerFlow[] }> {
  const [companies, pnls, { global, override }, assetReg, ownerships] = await Promise.all([
    prisma.company.findMany({ select: { id: true, legalName: true, baseCurrency: true } }),
    prisma.qboImport.findMany({
      where: { reportKind: "PROFIT_AND_LOSS", companyId: { not: null } },
      select: { id: true, companyId: true, periodLabel: true },
    }),
    rateConfig(),
    buildAssetRegister(year),
    prisma.ownership.findMany({
      where: { ownedCompanyId: { not: null }, endDate: null },
      select: {
        ownedCompanyId: true,
        percentage: true,
        ownerParty: { select: { name: true } },
        ownerCompany: { select: { legalName: true } },
      },
    }),
  ]);

  const taxDepByCompany = new Map(assetReg.byCompany.map((b) => [b.companyId, b.yearDep]));
  const ownersByCompany = new Map<string, { name: string; pct: number }[]>();
  for (const o of ownerships) {
    if (!o.ownedCompanyId) continue;
    const name = o.ownerParty?.name ?? o.ownerCompany?.legalName;
    if (!name) continue;
    const arr = ownersByCompany.get(o.ownedCompanyId) ?? [];
    arr.push({ name, pct: Number(o.percentage.toString()) });
    ownersByCompany.set(o.ownedCompanyId, arr);
  }

  const byCompany = new Map<string, Pnl[]>();
  for (const p of pnls) {
    if (!p.companyId) continue;
    const arr = byCompany.get(p.companyId) ?? [];
    arr.push({ id: p.id, periodLabel: p.periodLabel });
    byCompany.set(p.companyId, arr);
  }

  const rows: ReserveRow[] = [];
  const flowMap = new Map<string, OwnerFlow>();

  for (const c of companies) {
    const cp = byCompany.get(c.id);
    if (!cp) continue;
    const { profit, periodLabel, importId, importIds } = await profitForYear(cp, year);
    if (periodLabel == null) continue; // sem P&L nesse ano

    const taxDep = taxDepByCompany.get(c.id) ?? 0;
    const hasAssets = taxDepByCompany.has(c.id);
    const bookDep = hasAssets ? await bookDepreciationOf(importIds) : 0;
    // Troca a depreciação contábil pela fiscal: lucro tributável = book + bookDep − taxDep.
    const depAdjustment = hasAssets ? Math.round((bookDep - taxDep) * 100) / 100 : 0;
    const taxableProfit = profit != null ? Math.round((profit + depAdjustment) * 100) / 100 : null;

    const hasOverride = override.has(c.id);
    const ratePct = hasOverride ? override.get(c.id)! : global;
    const reserve =
      taxableProfit != null && taxableProfit > 0 ? (taxableProfit * ratePct) / 100 : 0;

    const owners: ReserveOwner[] = (ownersByCompany.get(c.id) ?? []).map((o) => {
      const attributed =
        taxableProfit != null && taxableProfit > 0
          ? Math.round(((taxableProfit * o.pct) / 100) * 100) / 100
          : 0;
      return { name: o.name, pct: o.pct, attributed };
    });

    for (const o of owners) {
      if (o.attributed <= 0) continue;
      const f = flowMap.get(o.name) ?? { name: o.name, total: 0, from: [] };
      f.total = Math.round((f.total + o.attributed) * 100) / 100;
      f.from.push({ company: c.legalName, amount: o.attributed });
      flowMap.set(o.name, f);
    }

    rows.push({
      companyId: c.id,
      name: c.legalName,
      currency: c.baseCurrency,
      periodLabel,
      importId,
      profit,
      bookDep,
      taxDep,
      hasAssets,
      depAdjustment,
      taxableProfit,
      ratePct,
      hasOverride,
      reserve,
      owners,
    });
  }
  rows.sort((a, b) => b.reserve - a.reserve);
  const flow = [...flowMap.values()].sort((a, b) => b.total - a.total);
  return { rows, flow };
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
