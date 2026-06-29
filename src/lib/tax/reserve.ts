import { prisma } from "@/lib/db";
import { pnlTotals } from "@/lib/qbo/pnl";
import { qboPeriodKey, periodMonths } from "@/lib/qbo/period";
import { buildAssetRegister } from "@/lib/assets/depreciation";
import { bookDepFromLines, trustBookDepAdjustment, macrsAppliedToBase } from "@/lib/assets/book-tax-dep";
import { buildTreatmentResolver, isCorpTreatment, type TreatmentResolver } from "@/lib/tax/treatment";
import { isEffectiveAt, asOfYearEnd } from "@/lib/ownership/effective";
import { buildTaxPreview, type TaxPreviewRow } from "@/lib/tax/preview";

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

// Depreciação contábil (book) lançada no P&L — fonte única (book-tax-dep).
async function bookDepreciationOf(importIds: string[]): Promise<number> {
  if (importIds.length === 0) return 0;
  const lines = await prisma.qboImportLine.findMany({
    where: { importId: { in: importIds }, lineType: "ACCOUNT" },
    select: { lineType: true, label: true, value: true },
  });
  return bookDepFromLines(lines);
}

// Overrides de alíquota POR EMPRESA (TaxReserveRate, exceto a linha GLOBAL — aposentada). O default
// não é mais um flat global: vem SEMPRE da classe/ano (TaxRateYear) via classRate. Fonte única.
async function rateConfig() {
  const rates = await prisma.taxReserveRate.findMany({ where: { companyId: { not: GLOBAL_RATE_KEY } } });
  const override = new Map(rates.map((r) => [r.companyId, Number(r.ratePct)]));
  return { override };
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

// FONTE ÚNICA da alíquota de uma empresa: override por empresa (TaxReserveRate), senão a alíquota
// da CLASSE (corp 21% / demais 30%) do ANO (TaxRateYear). Year-aware e class-aware. Usada por TODOS
// os consumidores (buildTaxReserve, quarterly, breakdown, companyReserve) — sem flat global.
export const classRate = (
  taxTreatment: string | null,
  override: Map<string, number>,
  companyId: string,
  yr: YearRates,
) => (override.has(companyId) ? override.get(companyId)! : isCorpTreatment(taxTreatment) ? yr.corpPct : yr.passPct);

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
  macrsApplied: boolean; // livro sem depreciação → MACRS aplicada na base (senão confia no livro)
  depAdjustment: number; // ajuste na base: 0 (confia no livro) ou −MACRS (livro sem dep)
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
  const [companies, pnls, { override }, yr, assetReg, ownerships, returns, taxStatuses] = await Promise.all([
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
      where: { ownedCompanyId: { not: null } },
      select: {
        ownedCompanyId: true,
        percentage: true,
        effectiveDate: true,
        endDate: true,
        ownerParty: { select: { name: true } },
        ownerCompany: { select: { legalName: true } },
      },
    }),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null }, taxTreatment: { not: null } },
      select: { companyId: true, taxTreatment: true, year: true, createdAt: true },
    }),
    prisma.companyTaxStatus.findMany({ select: { companyId: true, year: true, taxTreatment: true } }),
  ]);

  // Depreciação REAL do ano (livro registrado onde houver, senão MACRS efetiva) — não a MACRS teórica.
  const taxDepByCompany = new Map(assetReg.byCompany.map((b) => [b.companyId, b.realDep]));
  // Classe corp/pass por (empresa, ano): cadastro do ano > IR do ano > último conhecido (resolver único).
  const resolveTreatment: TreatmentResolver = buildTreatmentResolver(
    taxStatuses,
    returns.filter((r) => r.companyId && r.year != null) as Parameters<typeof buildTreatmentResolver>[1],
  );
  // Donos vigentes NO ANO (não os de hoje) — fonte única de vigência (isEffectiveAt @ 31/dez).
  const asOf = asOfYearEnd(year);
  const ownersByCompany = new Map<string, { name: string; pct: number }[]>();
  for (const o of ownerships) {
    if (!o.ownedCompanyId || !isEffectiveAt(o, asOf)) continue;
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
    // CONFIA no livro (mesma regra do Tax preview): se o livro já tem depreciação, ajuste 0; só
    // aplica a MACRS (−taxDep) quando o livro NÃO tem depreciação. Não infla pela diferença.
    const depAdjustment = trustBookDepAdjustment(bookDep, taxDep, hasAssets);
    const macrsApplied = macrsAppliedToBase(bookDep, taxDep, hasAssets);
    const taxableProfit = profit != null ? Math.round((profit + depAdjustment) * 100) / 100 : null;

    const treatment = resolveTreatment(c.id, year).treatment;
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
      macrsApplied,
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
  const [companies, pnls, { override }, yr, deposits, returns, assetReg, taxStatuses] = await Promise.all([
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
      select: { companyId: true, taxTreatment: true, year: true, createdAt: true },
    }),
    buildAssetRegister(year),
    prisma.companyTaxStatus.findMany({ select: { companyId: true, year: true, taxTreatment: true } }),
  ]);
  // Depreciação REAL do ano (livro registrado onde houver, senão MACRS efetiva).
  const taxDepByCompany = new Map(assetReg.byCompany.map((b) => [b.companyId, b.realDep]));
  const resolveTreatment: TreatmentResolver = buildTreatmentResolver(
    taxStatuses,
    returns.filter((r) => r.companyId && r.year != null) as Parameters<typeof buildTreatmentResolver>[1],
  );

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

    // Ajuste de depreciação livro→fiscal (confia no livro) — mesma regra do buildTaxReserve.
    const taxDep = taxDepByCompany.get(c.id) ?? 0;
    const hasAssets = taxDepByCompany.has(c.id);
    const bookDep = hasAssets ? await bookDepreciationOf(imports.map((i) => i.id)) : 0;
    const depAdj = trustBookDepAdjustment(bookDep, taxDep, hasAssets);
    if (depAdj !== 0) {
      const nq = qProfit.filter((p) => p != null).length || 1;
      const perQ = depAdj / nq;
      for (let i = 0; i < 4; i++) if (qProfit[i] != null) qProfit[i] = (qProfit[i] ?? 0) + perQ;
      if (annualProfit != null) annualProfit += depAdj;
    }

    const ratePct = classRate(resolveTreatment(c.id, year).treatment, override, c.id, yr);
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

// Estimativa de IR de UMA empresa num ano — para a aba da empresa. Usa a MESMA alíquota do reserve
// principal (classRate: override por empresa, senão classe/ano), recebendo o treatment já resolvido
// pela página (cadastro > IR). Antes usava um flat global e divergia do reserve.
export async function companyReserve(companyId: string, year: number, taxTreatment: string | null) {
  const [pnls, { override }, yr] = await Promise.all([
    prisma.qboImport.findMany({
      where: { companyId, reportKind: "PROFIT_AND_LOSS" },
      select: { id: true, periodLabel: true },
    }),
    rateConfig(),
    yearRates(year),
  ]);
  const { profit, periodLabel, importId } = await profitForYear(pnls, year);
  const hasOverride = override.has(companyId);
  const ratePct = classRate(taxTreatment, override, companyId, yr);
  const reserve = profit != null && profit > 0 ? (profit * ratePct) / 100 : 0;
  return { profit, periodLabel, importId, ratePct, hasOverride, reserve };
}

// RESERVE POR ENTIDADE — fonte ÚNICA da base: consome o motor do Tax preview (lucro book + ajustes
// + depreciação real + K-1 cascateado, cada entidade na sua classe), e aplica POR CIMA a alíquota de
// PROVISÃO do reserve (conservadora): C-corp paga 21% sobre a base (incl. K-1 recebido); pessoa
// física reserva passPct (default 30%) sobre a base já líquida da cascata (prejuízos compensam);
// pass-through repassa (0 no nível). Override por empresa vence a classe. Corrige a dupla-contagem,
// a alíquota errada do dono C-corp e o K-1 que não entrava na base.
export type ReserveEntityRow = TaxPreviewRow & {
  reserveRate: number; // alíquota de provisão aplicada
  reserve: number; // caixa a reservar (0 p/ pass-through, que repassa)
  hasOverride: boolean;
};

export interface ReserveByEntity {
  year: number;
  rows: ReserveEntityRow[];
  totalReserve: number;
  corpReserve: number; // soma das C-corp
  ownerReserve: number; // soma das pessoas (PF)
  excludedNonUsd: string[];
  excludedClosed: string[];
  missingPnl: string[];
}

export async function buildReserveByEntity(year: number): Promise<ReserveByEntity> {
  const [preview, { override }, yr] = await Promise.all([
    buildTaxPreview(year),
    rateConfig(),
    yearRates(year),
  ]);
  const rows: ReserveEntityRow[] = preview.rows.map((r) => {
    const hasOverride = r.kind === "company" && override.has(r.id);
    const reserveRate = hasOverride
      ? override.get(r.id)!
      : r.entityType === "C-corp"
        ? yr.corpPct
        : r.entityType === "PF"
          ? yr.passPct
          : 0; // pass-through repassa
    const reserve =
      r.entityType === "Pass-through" ? 0 : Math.round(Math.max(0, r.taxable) * reserveRate) / 100;
    return { ...r, reserveRate, reserve, hasOverride };
  });
  const sum = (f: (r: ReserveEntityRow) => boolean) =>
    Math.round(rows.filter(f).reduce((s, r) => s + r.reserve, 0) * 100) / 100;
  return {
    year,
    rows,
    totalReserve: sum(() => true),
    corpReserve: sum((r) => r.entityType === "C-corp"),
    ownerReserve: sum((r) => r.entityType === "PF"),
    excludedNonUsd: preview.excludedNonUsd,
    excludedClosed: preview.excludedClosed,
    missingPnl: preview.missingPnl,
  };
}

// PAGAMENTOS ESTIMADOS por trimestre — usa o MOTOR DO PREVIEW por PERÍODO (fonte única): o imposto
// CUMULATIVO devido até o fim do trimestre = lucro YTD real do período + MACRS proporcional (× Q/4)
// + add-backs + K-1 cascateado, tributado como no IR (C-corp 21%, PF nas faixas; pass-through repassa).
// A PARCELA do trimestre = cumulativo até Q − cumulativo até Q-1. Se faltar o P&L YTD do período de
// alguma empresa do escopo, o relatório NÃO é gerado (evita pagar sobre livro incompleto).
export const CORP_ESTIMATE_DUE = ["Apr 15", "Jun 15", "Sep 15", "Dec 15"]; // 1120-W (ano-calendário)
export const INDIVIDUAL_ESTIMATE_DUE = ["Apr 15", "Jun 15", "Sep 15", "Jan 15 (ano seg.)"]; // 1040-ES

export interface EstimatedPaymentRow {
  key: string;
  kind: "company" | "person";
  id: string;
  name: string;
  entityType: TaxPreviewRow["entityType"]; // só "C-corp" | "PF" (pass-through é filtrada)
  cumulativeTax: number; // imposto devido ACUMULADO até o fim do trimestre
  priorPaidThrough: number; // devido acumulado até o trimestre anterior
  installment: number; // parcela do trimestre = cumulativo − anterior (≥0)
  due: string; // vencimento do trimestre (por tipo)
  pnlImportId: string | null; // fonte clicável (P&L YTD do período)
}

export interface EstimatedPayments {
  year: number;
  quarter: number; // 1..4
  rows: EstimatedPaymentRow[]; // pagadores finais (C-corp + PF)
  totalCumulative: number;
  totalInstallment: number;
  corpDue: string;
  individualDue: string;
  blockedMissingPnl: string[]; // empresas no escopo sem o P&L YTD do período → relatório bloqueado
}

export async function buildEstimatedPayments(year: number, quarter: number): Promise<EstimatedPayments> {
  const q = quarter >= 1 && quarter <= 4 ? quarter : 1;
  const corpDue = CORP_ESTIMATE_DUE[q - 1];
  const individualDue = INDIVIDUAL_ESTIMATE_DUE[q - 1];
  // Preview por PERÍODO: até o fim de Q (throughMonths = 3·Q) e até o fim de Q-1 (para a diferença).
  const [cum, prior] = await Promise.all([
    buildTaxPreview(year, { throughMonths: 3 * q }),
    q > 1 ? buildTaxPreview(year, { throughMonths: 3 * (q - 1) }) : Promise.resolve(null),
  ]);
  const priorTaxByKey = new Map((prior?.rows ?? []).map((r) => [r.key, r.tax]));
  const rows: EstimatedPaymentRow[] = cum.rows
    .filter((r) => r.entityType !== "Pass-through")
    .map((r) => {
      const cumulativeTax = r.tax;
      const priorPaidThrough = priorTaxByKey.get(r.key) ?? 0;
      const installment = Math.max(0, Math.round((cumulativeTax - priorPaidThrough) * 100) / 100);
      return {
        key: r.key,
        kind: r.kind,
        id: r.id,
        name: r.name,
        entityType: r.entityType,
        cumulativeTax,
        priorPaidThrough,
        installment,
        due: r.entityType === "C-corp" ? corpDue : individualDue,
        pnlImportId: r.pnlImportId,
      };
    })
    .filter((r) => r.cumulativeTax > 0.005 || r.installment > 0.005)
    .sort((a, b) => b.installment - a.installment);
  return {
    year,
    quarter: q,
    rows,
    totalCumulative: Math.round(rows.reduce((s, r) => s + r.cumulativeTax, 0) * 100) / 100,
    totalInstallment: Math.round(rows.reduce((s, r) => s + r.installment, 0) * 100) / 100,
    corpDue,
    individualDue,
    blockedMissingPnl: cum.missingPnl,
  };
}
