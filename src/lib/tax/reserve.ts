import { prisma } from "@/lib/db";
import { pnlTotals } from "@/lib/qbo/pnl";
import { qboPeriodKey, periodMonths } from "@/lib/qbo/period";
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

// Alíquotas de provisão do ANO (defaults se não houver linha): C-corp 21%, demais 30%,
// Florida 5,5% + isenção $50k.
export interface YearRates {
  corpPct: number;
  passPct: number;
  flPct: number;
  flExemption: number;
}
export async function yearRates(year: number): Promise<YearRates> {
  const row = await prisma.taxRateYear.findUnique({ where: { year } });
  return {
    corpPct: row ? Number(row.corpPct) : 21,
    passPct: row ? Number(row.passPct) : DEFAULT_RATE,
    flPct: row ? Number(row.flPct) : 5.5,
    flExemption: row ? Number(row.flExemption) : 50000,
  };
}

const isCorp = (t: string | null | undefined) => (t ?? "").toUpperCase() === "C_CORP";
// Alíquota da empresa: override por empresa, senão a da classe (corp 21 / demais 30) do ano.
const classRate = (
  taxTreatment: string | null,
  override: Map<string, number>,
  companyId: string,
  yr: YearRates,
) => (override.has(companyId) ? override.get(companyId)! : isCorp(taxTreatment) ? yr.corpPct : yr.passPct);

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

// A provisão só vale para o ano VIGENTE e o ANTERIOR, e nunca antes de 2025.
// Anos mais antigos ficam arquivados (fora do seletor).
export const RESERVE_MIN_YEAR = 2025;
export function reserveScopeYears(): number[] {
  const cur = new Date().getUTCFullYear();
  return [cur, cur - 1].filter((y) => y >= RESERVE_MIN_YEAR);
}

// Anos do seletor: vigente + anterior (≥2025) que tenham P&L; o vigente sempre aparece.
export async function reserveYears(): Promise<number[]> {
  const cur = new Date().getUTCFullYear();
  const allowed = reserveScopeYears();
  const pnls = await prisma.qboImport.findMany({
    where: { reportKind: "PROFIT_AND_LOSS", companyId: { not: null } },
    select: { periodLabel: true },
  });
  const ys = new Set<number>();
  for (const p of pnls) {
    const y = yearOf(p.periodLabel);
    if (y) ys.add(y);
  }
  return allowed.filter((y) => y === cur || ys.has(y));
}

export type ReserveOwner = { name: string; pct: number; attributed: number };

export type ReserveRow = {
  companyId: string;
  name: string;
  currency: string;
  state: string | null;
  taxTreatment: string | null;
  periodLabel: string | null;
  importId: string | null;
  profit: number | null; // lucro contábil (book) do P&L
  bookDep: number; // depreciação contábil lançada no P&L
  taxDep: number; // depreciação fiscal calculada (MACRS)
  hasAssets: boolean; // há ativos cadastrados p/ ajustar?
  depAdjustment: number; // book − tax (entra no lucro tributável)
  taxableProfit: number | null; // lucro ajustado (pode ser negativo → compensa no dono)
  ratePct: number;
  hasOverride: boolean;
  reserve: number; // reserva da empresa (≥0), antes da compensação no dono
  owners: ReserveOwner[]; // para quem o lucro/prejuízo flui (ownership direto)
};

// Fluxo por dono: prejuízos COMPENSAM lucros (net pode ser negativo); a reserva sai do net ≥ 0.
export type OwnerFlow = {
  name: string;
  net: number; // base após compensar lucros e prejuízos
  ratePct: number;
  reserve: number; // max(0, net) × taxa
  from: { company: string; amount: number }[]; // assinado (prejuízo negativo)
};

// Provisão de IR de todas as empresas para um ANO — com ajuste de depreciação (book→fiscal)
// e o fluxo de lucro para os donos, onde PREJUÍZOS COMPENSAM LUCROS (nível do dono).
export async function buildTaxReserve(
  year: number,
): Promise<{ rows: ReserveRow[]; flow: OwnerFlow[] }> {
  const [companies, pnls, { override }, yr, assetReg, ownerships, returns] = await Promise.all([
    // Reserva de IR é lógica US (21%/30%) — só empresas em USD (não consolida EUR/BRL).
    prisma.company.findMany({
      where: { baseCurrency: "USD" },
      select: { id: true, legalName: true, baseCurrency: true, state: true },
    }),
    prisma.qboImport.findMany({
      where: { reportKind: "PROFIT_AND_LOSS", companyId: { not: null } },
      select: { id: true, companyId: true, periodLabel: true },
    }),
    rateConfig(),
    yearRates(year),
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
    prisma.taxReturn.findMany({
      where: { companyId: { not: null }, taxTreatment: { not: null } },
      select: { companyId: true, taxTreatment: true, year: true },
      orderBy: { year: "desc" },
    }),
  ]);

  const taxDepByCompany = new Map(assetReg.byCompany.map((b) => [b.companyId, b.yearDep]));
  const treatmentByCompany = new Map<string, string>();
  for (const r of returns) {
    if (r.companyId && !treatmentByCompany.has(r.companyId)) {
      treatmentByCompany.set(r.companyId, r.taxTreatment ?? "");
    }
  }
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
  const flowMap = new Map<string, { name: string; net: number; from: { company: string; amount: number }[] }>();

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

    const treatment = treatmentByCompany.get(c.id) ?? null;
    const hasOverride = override.has(c.id);
    const ratePct = classRate(treatment, override, c.id, yr);
    const reserve =
      taxableProfit != null && taxableProfit > 0 ? (taxableProfit * ratePct) / 100 : 0;

    // Atribuição ASSINADA: prejuízo entra negativo e compensa no dono.
    const owners: ReserveOwner[] = (ownersByCompany.get(c.id) ?? []).map((o) => ({
      name: o.name,
      pct: o.pct,
      attributed: taxableProfit != null ? Math.round(((taxableProfit * o.pct) / 100) * 100) / 100 : 0,
    }));

    for (const o of owners) {
      if (o.attributed === 0) continue;
      const f = flowMap.get(o.name) ?? { name: o.name, net: 0, from: [] };
      f.net = Math.round((f.net + o.attributed) * 100) / 100;
      f.from.push({ company: c.legalName, amount: o.attributed });
      flowMap.set(o.name, f);
    }

    rows.push({
      companyId: c.id,
      name: c.legalName,
      currency: c.baseCurrency,
      state: c.state,
      taxTreatment: treatment,
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
  // No nível do dono (pass-through), aplica a alíquota de pass-through do ano.
  const flow: OwnerFlow[] = [...flowMap.values()]
    .map((f) => ({
      name: f.name,
      net: f.net,
      ratePct: yr.passPct,
      reserve: f.net > 0 ? Math.round(((f.net * yr.passPct) / 100) * 100) / 100 : 0,
      from: f.from,
    }))
    .sort((a, b) => b.net - a.net);
  return { rows, flow };
}

// ── Fechamento TRIMESTRAL (estimated tax) ───────────────────────────────────
// Os trimestres mapeiam os vencimentos do estimated tax corporativo:
export const QUARTER_DUE = ["Apr 15", "Jun 15", "Sep 15", "Dec 15"];
const quarterOf = (m: number) => Math.ceil(m / 3); // 1..4

export type QuarterlyRow = {
  companyId: string;
  name: string;
  currency: string;
  ratePct: number;
  quarters: { profit: number | null; reserve: number; funded: number }[]; // Q1..Q4
  annualOnly: boolean; // só tem P&L anual (sem detalhe trimestral)
  fyProfit: number | null;
  fyReserve: number;
  fyFunded: number; // aportado de fato na conta-reserva
  fyGap: number; // necessário − aportado (positivo = falta provisionar)
};

export async function buildQuarterlyReserve(year: number): Promise<{ rows: QuarterlyRow[] }> {
  const [companies, pnls, { override }, yr, deposits, returns] = await Promise.all([
    prisma.company.findMany({
      where: { baseCurrency: "USD" },
      select: { id: true, legalName: true, baseCurrency: true },
    }),
    prisma.qboImport.findMany({
      where: { reportKind: "PROFIT_AND_LOSS", companyId: { not: null } },
      select: { id: true, companyId: true, periodLabel: true },
    }),
    rateConfig(),
    yearRates(year),
    // Só aportes marcados como RESERVE contam como funded (outros: empréstimo, juros…).
    prisma.reserveDeposit.findMany({
      where: { year, purpose: "RESERVE" },
      select: { companyId: true, quarter: true, amount: true },
    }),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null }, taxTreatment: { not: null } },
      select: { companyId: true, taxTreatment: true, year: true },
      orderBy: { year: "desc" },
    }),
  ]);
  const treatmentByCompany = new Map<string, string>();
  for (const r of returns) {
    if (r.companyId && !treatmentByCompany.has(r.companyId)) {
      treatmentByCompany.set(r.companyId, r.taxTreatment ?? "");
    }
  }

  const fundedByCompany = new Map<string, number[]>(); // [Q1..Q4]
  for (const d of deposits) {
    const arr = fundedByCompany.get(d.companyId) ?? [0, 0, 0, 0];
    if (d.quarter >= 1 && d.quarter <= 4) arr[d.quarter - 1] += Number(d.amount.toString());
    fundedByCompany.set(d.companyId, arr);
  }

  // Granularidade trimestral SÓ no ano vigente; anos anteriores entram como anual.
  const showQuarters = year === new Date().getUTCFullYear();

  const byCompany = new Map<string, { id: string; periodLabel: string }[]>();
  for (const p of pnls) {
    if (!p.companyId || yearOf(p.periodLabel) !== year) continue;
    const arr = byCompany.get(p.companyId) ?? [];
    arr.push({ id: p.id, periodLabel: p.periodLabel });
    byCompany.set(p.companyId, arr);
  }

  const rows: QuarterlyRow[] = [];
  for (const c of companies) {
    const imports = byCompany.get(c.id);
    if (!imports) continue;

    const qProfit: (number | null)[] = [null, null, null, null];
    let annualProfit: number | null = null;
    let hasQuarterData = false;

    for (const imp of imports) {
      const pm = periodMonths(imp.periodLabel);
      const ni = await netIncomeOf(imp.id);
      if (ni == null) continue;
      if (showQuarters && pm && quarterOf(pm.start) === quarterOf(pm.end)) {
        const q = quarterOf(pm.start) - 1;
        qProfit[q] = (qProfit[q] ?? 0) + ni;
        hasQuarterData = true;
      } else {
        // Anual, multi-trimestre, ou ano não-vigente → trata como anual.
        annualProfit = (annualProfit ?? 0) + ni;
      }
    }

    const ratePct = classRate(treatmentByCompany.get(c.id) ?? null, override, c.id, yr);
    const r = (p: number | null) =>
      p != null && p > 0 ? Math.round(((p * ratePct) / 100) * 100) / 100 : 0;

    const annualOnly = !hasQuarterData && annualProfit != null;
    const funded = fundedByCompany.get(c.id) ?? [0, 0, 0, 0];
    const quarters = qProfit.map((p, i) => ({ profit: p, reserve: r(p), funded: funded[i] }));
    const fyProfit = hasQuarterData
      ? qProfit.reduce<number | null>((s, p) => (p == null ? s : (s ?? 0) + p), null)
      : annualProfit;
    const fyReserve = hasQuarterData
      ? quarters.reduce((s, q) => s + q.reserve, 0)
      : r(annualProfit);
    const fyFunded = funded.reduce((s, v) => s + v, 0);

    // Sem dados de aporte E sem necessidade → pula (não polui a tabela). Mantém se houver algo.
    rows.push({
      companyId: c.id,
      name: c.legalName,
      currency: c.baseCurrency,
      ratePct,
      quarters,
      annualOnly,
      fyProfit,
      fyReserve: Math.round(fyReserve * 100) / 100,
      fyFunded: Math.round(fyFunded * 100) / 100,
      fyGap: Math.round((fyReserve - fyFunded) * 100) / 100,
    });
  }
  rows.sort((a, b) => b.fyReserve - a.fyReserve);
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
