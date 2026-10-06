/**
 * Report mensal do pool (Fase 5, mock aprovado 19/07/2026): monta o ReportMonthData de
 * um mês com corte AS-OF (último dia do mês, ou hoje se o mês está em curso) reusando
 * os módulos das Fases 0–4 — feed, nav, risk, investor-value, benchmark. O snapshot
 * publicado (PoolDocument.data) congela o resultado: o report de julho nunca muda
 * quando agosto acontece. Narrativa default gerada dos eventos; editável ao publicar.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
// glue interno: o pool com includes do Prisma passa por uma visão as-of mutada — tipagem
// estrutural fina aqui só atrapalha; os módulos consumidores (risk/nav/endNet) são tipados.
import { prisma } from "@/lib/db";
import { computeNav, liveIrr, xirr, type NavHouse } from "./nav";
import { buildRisk } from "./risk";
import { computeEndNet } from "./investor-value";
import { computeDistributable, performanceSummary } from "./distributable";
import { buildActivityFeed } from "./activity-feed";
import { ncStatsForLocation } from "./benchmark";
import { milestonePctAsOf, type HouseMilestones, type MilestoneCatalog } from "./milestones";
import type { Lang } from "./i18n";

const n = (v: unknown) => (v == null ? 0 : Number(v));
const round2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date) => d.toISOString();

export type ReportMonthData = {
  month: string; // "AAAA-MM"
  generatedAt: string;
  cutoff: string;
  poolCode: string;
  poolName: string;
  currency: string;
  kpis: {
    unitPar: number;
    navPerUnit: number | null;
    navPerUnitPrev: number | null;
    endPerUnitNet: number | null;
    irrLive: number | null;
    irrPlan: number | null;
    housesStarted: number;
    housesTotal: number;
    sold: number;
    raised: number;
    target: number | null;
    pctRaised: number | null;
    runwayMonths: number | null;
    nextDist: { month: string; total: number; addr: string } | null;
  };
  narrative: string;
  events: Array<{ date: string; icon: string; text: string }>;
  cascade: Array<{ key: string; amount: number }>;
  chart: { par: number; today: number | null; end: number | null; startLabel: string; endLabel: string };
  schedule: Array<{
    house: string;
    milestone: string;
    baseline: string | null;
    real: string | null;
    deltaDays: number | null;
    late: boolean;
  }>;
  risk: {
    freeCash: number;
    monthlyInterest: number;
    callMin: number | null;
    callSuff: number | null;
    breakevenPct: number | null;
    stress: Array<{ label: string; profit: number; tone: string }>;
  };
  market: {
    green: number;
    amber: number;
    red: number;
    // estruturado (19/07): renderiza no idioma do LEITOR (antes eram strings PT fixas
    // vazando no report EN); compat: snapshots antigos têm string[]
    notes: Array<{ addr: string; kind: "CEILING" | "P90" | "THIN_MARGIN"; pct?: number } | string>;
  };
  marketCommentary?: string; // parágrafo do gestor sobre mercado (IA, editável)
  dist: {
    inMonth: number;
    cumulative: number;
    queueCount: number;
    queueTotal: number;
    queueCapital: number;
    queueProfit: number;
    // performance (06/10): acordo × decisões gravadas + capital devolvido; snapshots antigos não têm
    capitalReturned?: number;
    raised?: number;
    perf?: { agreedPct: number | null; paid: number; provisioned: number; waived: number; waiveRemaining: boolean; payee: string | null };
    safeDistributable?: number;
  };
  // Relatório de ENCERRAMENTO (06/10): derivado do mensal — presente quando todas as casas
  // estão vendidas e o pool está em Closing/Closed. Substitui as seções de projeção.
  final?: FinalReportData;
};

export type FinalReportData = {
  startDate: string | null;
  firstLotDate: string | null;
  lastSaleDate: string | null;
  closedAt: string; // última distribuição (ou o corte)
  months: number;
  houses: Array<{
    address: string;
    saleDate: string | null;
    plannedSale: number | null;
    soldPrice: number | null;
    plannedCost: number | null; // lote + obra + closing (pro forma)
    realCost: number | null; // lote + obra + change orders + closing real
    profitPlanned: number | null;
    profitReal: number | null;
  }>;
  cascade: {
    raised: number;
    equityToHouses: number;
    salesNet: number;
    bankCosts: number; // juros + fees + reserve − créditos (informativo: já dentro dos payoffs)
    poolIncome: number;
    poolExpenses: number;
    profit: number; // recebido + receitas − capital − despesas
    performancePaid: number;
    performanceWaived: number;
    performanceProvisioned: number;
    distributedCapital: number;
    distributedProfit: number;
    cashLeft: number;
  };
  performance: { agreedPct: number | null; payee: string | null; decision: string | null };
  investors: Array<{
    name: string;
    role: string;
    pct: number;
    invested: number;
    returnedCapital: number;
    profit: number;
    total: number;
    roi: number | null;
    irr: number | null;
  }>;
  projectIrr: number | null; // XIRR do conjunto dos sócios (fluxos reais)
  profitPct: number | null; // lucro ÷ capital
};

const DAY_MS = 86_400_000;

// visão AS-OF do pool: lançamentos até o corte; datas reais depois do corte viram null
// (a casa vendida em agosto ainda é "não vendida" no report de julho)
function poolAt(pool: any, asOf: Date): any {
  const cut = (d: unknown) => (d instanceof Date && d.getTime() > asOf.getTime() ? null : d);
  const HOUSE_DATES = [
    "lotContractDate", "lotPaidDate", "permitAppliedDate", "permitIssuedDate",
    "buildStartDate", "coDate", "listedDate", "contractDate", "saleDate",
  ];
  return {
    ...pool,
    houses: pool.houses.map((h: any) => {
      const x: Record<string, unknown> = { ...h };
      for (const k of HOUSE_DATES) x[k] = cut(x[k]);
      const le = x.loanEntries as Array<{ date?: Date }> | undefined;
      if (le) x.loanEntries = le.filter((e) => !e.date || e.date.getTime() <= asOf.getTime());
      return x;
    }),
    members: pool.members.map((m: any) => ({
      ...m,
      entries: m.entries.filter((e: any) => e.date.getTime() <= asOf.getTime()),
    })),
    distributions: pool.distributions.filter((d: any) => d.date.getTime() <= asOf.getTime()),
    expenses: pool.expenses.filter((e: any) => e.date.getTime() <= asOf.getTime()),
    loans: pool.loans.map((l: any) => ({
      ...l,
      entries: l.entries.filter((e: any) => e.date.getTime() <= asOf.getTime()),
    })),
  };
}

// visão frouxa (mas explícita) do pool as-of — evita implicit-any nos callbacks
type Loose = Record<string, any>;
type PoolView = {
  houses: Loose[];
  members: Array<Loose & { entries: Loose[] }>;
  distributions: Loose[];
  expenses: Loose[];
  loans: Array<Loose & { entries: Loose[]; documents: Loose[] }>;
} & Loose;

// métricas centrais num corte (usada p/ o mês e p/ o Δ do mês anterior)
function metricsAt(poolRaw: any, asOf: Date, mCatalog: MilestoneCatalog[] = []) {
  const pool = poolAt(poolRaw, asOf) as PoolView;
  const raised = pool.members
    .flatMap((m) => m.entries)
    .reduce((s, e) => s + ((e as { kind: string }).kind === "TRANSFER_OUT" ? -1 : 1) * n((e as { amount: unknown }).amount), 0);
  const received = pool.houses.reduce((s, h) => {
    const hh = h as { saleDate: unknown; netReceived: unknown; soldPrice: unknown; payoffAmount: unknown; closingCost: unknown };
    if (hh.saleDate == null) return s; // sem closing não entrou dinheiro (06/10)
    return (
      s +
      (hh.netReceived != null
        ? n(hh.netReceived)
        : hh.soldPrice != null
          ? n(hh.soldPrice) - n(hh.payoffAmount) - n(hh.closingCost)
          : 0)
    );
  }, 0);
  const spent = pool.houses.reduce((s, h) => s + n((h as { ownCapital: unknown }).ownCapital), 0);
  const expensesPaid = pool.expenses
    .filter((e) => (e as { status: string }).status === "PAID")
    .reduce((s, e) => s + n((e as { amount: unknown }).amount), 0);
  const provisioned = pool.expenses
    .filter((e) => (e as { status: string }).status === "PROVISIONED")
    .reduce((s, e) => s + n((e as { amount: unknown }).amount), 0);
  const distributed = pool.distributions.reduce(
    (s, d) => s + n((d as { totalAmount: unknown }).totalAmount),
    0,
  );
  const available = raised + received - spent - expensesPaid - distributed;

  const risk = buildRisk(pool as never, asOf);
  const baselineSaleByHouse = (() => {
    const b = pool.scheduleBaseline as {
      houses?: Array<{ houseId: string; sale: string | null }>;
    } | null;
    return new Map((b?.houses ?? []).map((h) => [h.houseId, h.sale ? new Date(h.sale) : null]));
  })();
  const navHouses: NavHouse[] = pool.houses.map((h) => {
    const hh = h as Record<string, unknown>;
    const drawn = (hh.loanEntries as Array<{ amount: unknown }>).reduce((s, e) => s + n(e.amount), 0);
    const cost = n(hh.plannedLotCost) + n(hh.plannedBuildCost) + n(hh.plannedClosingCost);
    const expectedProfit = hh.plannedSalePrice != null && cost > 0 ? n(hh.plannedSalePrice) - cost : null;
    const drawable = hh.bankLoanAmount != null ? n(hh.bankLoanAmount) : null;
    return {
      ownCapital: n(hh.ownCapital),
      bankDrawn: drawn,
      expectedProfit,
      buildPct:
        hh.coDate != null
          ? 100
          : (milestonePctAsOf(mCatalog, hh.milestones as HouseMilestones | null, asOf) ??
            (drawable && drawable > 0 ? Math.min(100, (drawn / drawable) * 100) : 0)),
      sold: hh.saleDate != null,
      baselineSale: baselineSaleByHouse.get(hh.id as string) ?? null,
    };
  });
  const debt = pool.loans.reduce(
    (s, l) =>
      s +
      Math.max(
        0,
        l.entries
          .filter((e) => !(e as { pending: boolean }).pending)
          .reduce((x, e) => x + n((e as { amount: unknown }).amount), 0),
      ),
    0,
  );
  const unitsTotal = pool.members.reduce(
    (s, m) =>
      s +
      m.entries.reduce(
        (x, e) =>
          x + ((e as { kind: string }).kind === "TRANSFER_OUT" ? -1 : 1) * n((e as { units: unknown }).units),
        0,
      ),
    0,
  );
  const financingIncurred = pool.loans
    .flatMap((l) => l.entries)
    .filter(
      (e) =>
        !(e as { pending: boolean }).pending &&
        ["CLOSING_FEE", "RESERVE", "DRAW_FEE", "INTEREST"].includes((e as { type: string }).type),
    )
    .reduce((s, e) => s + n((e as { amount: unknown }).amount), 0);
  const live = liveIrr({
    contributions: pool.members
      .flatMap((m) => m.entries)
      .filter((e) => ["CONTRIBUTION", "CAPITAL_CALL"].includes((e as { kind: string }).kind))
      .map((e) => ({ date: e.date, amount: n((e as { amount: unknown }).amount) })),
    distributions: pool.distributions.map((d) => ({
      date: d.date,
      amount: n((d as { totalAmount: unknown }).totalAmount),
    })),
    houses: navHouses,
    financingDrag: risk.financingDrag,
    freeCash: available,
    endDate: pool.effectiveEndDate ?? pool.plannedEndDate ?? null,
    today: asOf,
  });
  const navR = computeNav({
    freeCash: available - provisioned,
    houses: navHouses,
    debt,
    unitsTotal,
    raised,
    distributed,
    projectedProfitNet: live.profitNet,
  });
  const simKpis =
    (pool.simulations?.[0]?.result as { kpis?: Record<string, number | null> } | null)?.kpis ?? null;
  // performance (06/10): acordo × decisões gravadas até o corte
  const perf = performanceSummary(pool as never);
  const endNet = computeEndNet({
    freeCash: available,
    houses: pool.houses.map((h) => {
      const hh = h as Record<string, unknown>;
      return {
        addr: (hh.address as string).split(",")[0],
        sold: hh.saleDate != null,
        plannedLotCost: hh.plannedLotCost != null ? n(hh.plannedLotCost) : null,
        plannedBuildCost: hh.plannedBuildCost != null ? n(hh.plannedBuildCost) : null,
        plannedClosingCost: hh.plannedClosingCost != null ? n(hh.plannedClosingCost) : null,
        plannedSalePrice: hh.plannedSalePrice != null ? n(hh.plannedSalePrice) : null,
        ownCapital: n(hh.ownCapital),
        bankDrawn: (hh.loanEntries as Array<{ amount: unknown }>).reduce((s, e) => s + n(e.amount), 0),
        drawable: hh.bankLoanAmount != null ? n(hh.bankLoanAmount) : null,
        locationName: (hh.catalogLocation as { name: string } | null)?.name ?? null,
        sqft: (hh.catalogModel as { sqft: number | null } | null)?.sqft ?? null,
      };
    }),
    debt,
    financingComing: Math.max(0, risk.financingDrag - financingIncurred),
    provisionedExpenses: provisioned,
    hasEntity: pool.companyId != null && pool.ownEntity !== false, // LLC própria → provisiona encerramento
    hasWindDownProvision: pool.expenses.some((e) => (e as { category: string }).category === "DISSOLUTION"),
    raised,
    distributed,
    performancePct: perf.agreedPct,
    performanceSettled: perf.settled,
    performanceWaiveRemaining: perf.waiveRemaining,
    promotePlan: simKpis?.promoteTotal ?? null,
    vehicleCostPlan: simKpis?.vehicleCostTotal ?? null,
    expensesPaid,
    unitsTotal,
  });
  return { pool, risk, navR, live, endNet, raised, distributed, simKpis, unitsTotal, perf };
}

async function loadPool(poolId: string) {
  return prisma.investmentPool.findUnique({
    where: { id: poolId },
    include: {
      houses: {
        include: {
          catalogModel: { select: { name: true, sqft: true } },
          catalogLocation: { select: { name: true } },
          loanEntries: { where: { type: "DRAW", pending: false }, select: { amount: true, date: true } },
          changeOrders: { select: { amount: true } }, // encerramento: custo real da casa
        },
      },
      members: { include: { entries: true, party: true, company: true } },
      distributions: { orderBy: { date: "asc" }, include: { lines: true } },
      expenses: true,
      performancePayeeCompany: { select: { legalName: true } },
      performancePayeeParty: { select: { name: true } },
      loans: {
        orderBy: { createdAt: "asc" },
        include: {
          bankProfile: true,
          entries: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
          documents: { select: { id: true, fileName: true, kind: true, extracted: true, createdAt: true } },
        },
      },
      simulations: { orderBy: { updatedAt: "desc" }, take: 1 },
    },
  });
}

const MILESTONES: Array<[string, string, string]> = [
  // [label, campo do baseline, campo real da casa]
  ["EMD", "emd", "lotContractDate"],
  ["Lote comprado", "lotClose", "lotPaidDate"],
  ["Permit aplicado", "permitApp", "permitAppliedDate"],
  ["Permit emitido", "permitIssued", "permitIssuedDate"],
  ["Obra iniciada", "buildStart", "buildStartDate"],
  ["CO (obra 100%)", "buildEnd", "coDate"],
  ["Venda", "sale", "saleDate"],
];

// Relatório de encerramento: só quando todas as casas estão vendidas e o pool já saiu de Active.
// Tudo REALIZADO — nada de projeção. Reusa o corte as-of do mês.
function buildFinal(cur: ReturnType<typeof metricsAt>, asOf: Date): FinalReportData | undefined {
  const pool = cur.pool;
  const houses = pool.houses as Array<Record<string, unknown>>;
  if (houses.length === 0) return undefined;
  if (!houses.every((h) => h.saleDate != null)) return undefined;
  if (!["CLOSING", "CLOSED"].includes(pool.status as string)) return undefined;

  const isoD = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : null);
  const saleDates = houses.map((h) => h.saleDate as Date).filter(Boolean).sort((a, b) => a.getTime() - b.getTime());
  const lotDates = houses
    .map((h) => (h.lotPaidDate ?? h.lotContractDate ?? h.buildStartDate) as Date | null)
    .filter((d): d is Date => d instanceof Date)
    .sort((a, b) => a.getTime() - b.getTime());
  const dists = pool.distributions as Array<{ date: Date; kind: string; totalAmount: unknown; lines: Array<{ memberId: string; amount: unknown }> }>;
  const closedAt = dists.length ? dists[dists.length - 1].date : asOf;
  const start = (pool.startDate as Date | null) ?? lotDates[0] ?? saleDates[0];
  const months = start ? Math.max(1, Math.round((closedAt.getTime() - start.getTime()) / (30.44 * DAY_MS))) : 0;

  const hRows = houses.map((h) => {
    const co = ((h.changeOrders as Array<{ amount: unknown }> | undefined) ?? []).reduce((s, c) => s + n(c.amount), 0);
    const plannedCost = h.plannedLotCost != null || h.plannedBuildCost != null ? n(h.plannedLotCost) + n(h.plannedBuildCost) + n(h.plannedClosingCost) : null;
    const hasReal = h.actualLotCost != null || h.actualBuildCost != null;
    const realCost = hasReal ? n(h.actualLotCost) + n(h.actualBuildCost) + co + n(h.closingCost) : null;
    const plannedSale = h.plannedSalePrice != null ? n(h.plannedSalePrice) : null;
    const soldPrice = h.soldPrice != null ? n(h.soldPrice) : null;
    return {
      address: (h.address as string).split(",")[0],
      saleDate: isoD(h.saleDate),
      plannedSale,
      soldPrice,
      plannedCost,
      realCost,
      profitPlanned: plannedSale != null && plannedCost != null ? round2(plannedSale - plannedCost) : null,
      profitReal: soldPrice != null && realCost != null ? round2(soldPrice - realCost) : null,
    };
  });

  const members = pool.members as Array<{ id: string; role: string; party: { name: string } | null; company: { legalName: string } | null; entries: Array<{ kind: string; date: Date; amount: unknown; units: unknown }> }>;
  const raised = cur.raised;
  const equityToHouses = houses.reduce((s, h) => s + n(h.ownCapital), 0);
  const salesNet = houses.reduce((s, h) => s + (h.netReceived != null ? n(h.netReceived) : n(h.soldPrice) - n(h.payoffAmount) - n(h.closingCost)), 0);
  const expenses = pool.expenses as Array<{ status: string; category: string; amount: unknown; description: string }>;
  const paidExp = expenses.filter((e) => e.status === "PAID" && e.category !== "PERFORMANCE");
  const poolIncome = paidExp.filter((e) => n(e.amount) < 0).reduce((s, e) => s - n(e.amount), 0);
  const poolExpenses = paidExp.filter((e) => n(e.amount) > 0).reduce((s, e) => s + n(e.amount), 0);
  const perfRows = expenses.filter((e) => e.category === "PERFORMANCE");
  const perfSum = (st: string) => perfRows.filter((e) => e.status === st).reduce((s, e) => s + n(e.amount), 0);
  const bankCosts = (pool.loans as unknown as Array<{ entries: Array<{ type: string; amount: unknown; pending: boolean }> }>)
    .flatMap((l) => l.entries)
    .filter((e) => !e.pending && ["CLOSING_FEE", "RESERVE", "DRAW_FEE", "INTEREST", "RECONVEYANCE", "CREDIT"].includes(e.type))
    .reduce((s, e) => s + n(e.amount), 0);
  const profit = round2(salesNet + poolIncome - equityToHouses - poolExpenses - perfSum("PAID"));
  const distributedCapital = dists.filter((d) => d.kind === "RETURN_OF_CAPITAL").reduce((s, d) => s + n(d.totalAmount), 0);
  const distributedProfit = dists.filter((d) => d.kind === "PROFIT").reduce((s, d) => s + n(d.totalAmount), 0);
  const cashLeft = round2(raised + salesNet + poolIncome - equityToHouses - poolExpenses - perfSum("PAID") - distributedCapital - distributedProfit) || 0; // || 0 evita "-$0.00"

  const totalUnits = members.reduce((s, m) => s + m.entries.reduce((x, e) => x + (e.kind === "TRANSFER_OUT" ? -1 : 1) * n(e.units), 0), 0);
  const allFlows: Array<{ date: Date; amount: number }> = [];
  const investors = members
    .map((m) => {
      const units = m.entries.reduce((x, e) => x + (e.kind === "TRANSFER_OUT" ? -1 : 1) * n(e.units), 0);
      const invested = m.entries.reduce((x, e) => x + (e.kind === "TRANSFER_OUT" ? -1 : 1) * n(e.amount), 0);
      const flows: Array<{ date: Date; amount: number }> = m.entries
        .filter((e) => e.kind !== "TRANSFER_OUT")
        .map((e) => ({ date: e.date, amount: -n(e.amount) }));
      let returnedCapital = 0, profitRecv = 0;
      for (const d of dists)
        for (const l of d.lines)
          if (l.memberId === m.id) {
            flows.push({ date: d.date, amount: n(l.amount) });
            if (d.kind === "RETURN_OF_CAPITAL") returnedCapital += n(l.amount);
            else profitRecv += n(l.amount);
          }
      allFlows.push(...flows);
      const total = returnedCapital + profitRecv;
      return {
        name: m.company?.legalName ?? m.party?.name ?? "—",
        role: m.role,
        pct: totalUnits > 0 ? units / totalUnits : 0,
        invested: round2(invested),
        returnedCapital: round2(returnedCapital),
        profit: round2(profitRecv),
        total: round2(total),
        roi: invested > 0 ? total / invested - 1 : null,
        irr: xirr(flows),
      };
    })
    .filter((r) => r.invested > 0)
    .sort((a, b) => (a.role !== b.role ? (a.role === "MANAGER" ? -1 : 1) : b.invested - a.invested));

  return {
    startDate: isoD(start),
    firstLotDate: isoD(lotDates[0] ?? null),
    lastSaleDate: isoD(saleDates[saleDates.length - 1] ?? null),
    closedAt: closedAt.toISOString().slice(0, 10),
    months,
    houses: hRows,
    cascade: {
      raised: round2(raised),
      equityToHouses: round2(equityToHouses),
      salesNet: round2(salesNet),
      bankCosts: round2(bankCosts),
      poolIncome: round2(poolIncome),
      poolExpenses: round2(poolExpenses),
      profit,
      performancePaid: round2(perfSum("PAID")),
      performanceWaived: round2(perfSum("WAIVED")),
      performanceProvisioned: round2(perfSum("PROVISIONED")),
      distributedCapital: round2(distributedCapital),
      distributedProfit: round2(distributedProfit),
      cashLeft,
    },
    performance: {
      agreedPct: cur.perf.agreedPct,
      payee: cur.perf.payeeName,
      decision: perfRows.map((e) => e.description).filter(Boolean).join(" · ") || null,
    },
    investors,
    projectIrr: xirr(allFlows),
    profitPct: equityToHouses > 0 ? profit / equityToHouses : null,
  };
}

export async function buildMonthlyReport(
  poolId: string,
  month: string, // "AAAA-MM"
  lang: Lang,
): Promise<ReportMonthData | null> {
  const poolRaw = await loadPool(poolId);
  if (!poolRaw) return null;
  const [y, m] = month.split("-").map(Number);
  if (!y || !m || m < 1 || m > 12) return null;
  const monthStart = new Date(Date.UTC(y, m - 1, 1));
  const monthEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  const now = new Date();
  // Encerramento (06/10): projeto fechado -> o corte vai ao fim do mes, para uma distribuicao
  // datada alguns dias a frente (data do wire) entrar no relatorio em vez de sumir
  const closingMode =
    poolRaw.houses.length > 0 &&
    poolRaw.houses.every((h) => h.saleDate != null) &&
    ["CLOSING", "CLOSED"].includes(poolRaw.status);
  const asOf = closingMode || monthEnd.getTime() < now.getTime() ? monthEnd : now;

  const mCatalog: MilestoneCatalog[] = (
    await prisma.catalogBuildMilestone.findMany({ orderBy: { sortOrder: "asc" } })
  ).map((r) => ({ key: r.key, name: r.name, detail: r.detail, weightPct: Number(r.weightPct), sortOrder: r.sortOrder }));
  const cur = metricsAt(poolRaw, asOf, mCatalog);
  const prev = metricsAt(poolRaw, new Date(Date.UTC(y, m - 1, 0, 23, 59, 59)), mCatalog);
  const finalData = buildFinal(cur, asOf);

  // eventos do mês (feed da Fase 0 na visão as-of)
  const houseAddrById = new Map(cur.pool.houses.map((h) => [(h as { id: string }).id, (h as { address: string }).address]));
  const feed = buildActivityFeed(
    {
      members: cur.pool.members.map((mm) => ({
        name: "—",
        entries: mm.entries.map((e) => ({ kind: e.kind as string, date: e.date as Date, amount: e.amount })),
      })),
      loans: cur.pool.loans.map((l) => ({
        bankName: (l.bankProfile?.name as string | undefined) ?? null,
        entries: l.entries.map((e) => ({
          type: e.type as string,
          date: e.date as Date,
          amount: e.amount,
          pending: e.pending as boolean,
          houseAddress: e.houseId ? (houseAddrById.get(e.houseId as string) ?? null) : null,
        })),
        documents: l.documents as Array<{ kind: string; fileName: string; createdAt: Date }>,
      })),
      houses: cur.pool.houses as never,
      distributions: cur.pool.distributions.map((d) => ({
        date: d.date,
        amount: (d as { lines: Array<{ amount: unknown }> }).lines.reduce((s, l) => s + n(l.amount), 0),
      })),
      expenses: cur.pool.expenses as never,
      currency: cur.pool.currency as string,
    },
    500,
  );
  const monthEvents = feed.events.filter(
    (e) => e.date.getTime() >= monthStart.getTime() && e.date.getTime() <= asOf.getTime(),
  );

  // cronograma: marcos do mês (real no mês, com Δ) + atrasos (baseline no mês sem real)
  const baseline = (poolRaw.scheduleBaseline as {
    houses?: Array<Record<string, string | null> & { houseId: string; label: string }>;
  } | null)?.houses ?? [];
  const baselineByHouse = new Map(baseline.map((b) => [b.houseId, b]));
  const schedule: ReportMonthData["schedule"] = [];
  for (const h of cur.pool.houses) {
    const hh = h as Record<string, unknown>;
    const b = baselineByHouse.get(hh.id as string);
    for (const [label, bField, rField] of MILESTONES) {
      const bDate = b?.[bField] ? new Date(b[bField] as string) : null;
      const rDate = (hh[rField] as Date | null) ?? null;
      const realInMonth =
        rDate && rDate.getTime() >= monthStart.getTime() && rDate.getTime() <= asOf.getTime();
      const lateInMonth =
        !rDate && bDate && bDate.getTime() >= monthStart.getTime() && bDate.getTime() <= asOf.getTime();
      if (!realInMonth && !lateInMonth) continue;
      schedule.push({
        house: (hh.address as string).split(",")[0],
        milestone: label,
        baseline: bDate ? bDate.toISOString() : null,
        real: rDate ? rDate.toISOString() : null,
        deltaDays: bDate && rDate ? Math.round((rDate.getTime() - bDate.getTime()) / DAY_MS) : null,
        late: !!lateInMonth,
      });
    }
  }

  // mercado: faróis (mesma régua da aba Casas › Mercado) — estruturados p/ i18n
  let green = 0, amber = 0, red = 0;
  const notes: ReportMonthData["market"]["notes"] = [];
  for (const h of cur.pool.houses) {
    const hh = h as Record<string, unknown>;
    if (hh.saleDate != null) continue;
    const cost = n(hh.plannedLotCost) + n(hh.plannedBuildCost) + n(hh.plannedClosingCost);
    const sale = hh.plannedSalePrice != null ? n(hh.plannedSalePrice) : null;
    const stats = (hh.catalogLocation as { name: string } | null)
      ? ncStatsForLocation((hh.catalogLocation as { name: string }).name)
      : null;
    const addr = (hh.address as string).split(",")[0];
    const marginPct = sale != null && cost > 0 ? ((sale - cost) / sale) * 100 : null;
    if (sale != null && stats && sale > stats.max) {
      red++;
      notes.push({ addr, kind: "CEILING" });
    } else if (sale != null && stats && sale >= stats.p90) {
      amber++;
      notes.push({ addr, kind: "P90" });
    } else if (marginPct != null && marginPct < 5) {
      amber++;
      notes.push({ addr, kind: "THIN_MARGIN", pct: Math.round(marginPct * 10) / 10 });
    } else green++;
  }

  // narrativa default (editável ao publicar) — determinística, dos eventos do mês
  const narrative =
    monthEvents.length === 0
      ? lang === "pt"
        ? "Sem eventos registrados no mês."
        : "No recorded events this month."
      : (lang === "pt"
          ? `O mês registrou ${monthEvents.length} evento(s): `
          : `The month recorded ${monthEvents.length} event(s): `) +
        monthEvents
          .slice(0, 8)
          .map((e) => e.text)
          .join("; ") +
        ".";

  const targetN = (poolRaw.targetAmount != null ? n(poolRaw.targetAmount) : null) as number | null;
  const nextDist = cur.risk.next?.date
    ? {
        month: `${cur.risk.next.date.getUTCFullYear()}-${String(cur.risk.next.date.getUTCMonth() + 1).padStart(2, "0")}`,
        total: cur.risk.next.total,
        addr: cur.risk.next.addr,
      }
    : null;
  const distInMonth = cur.pool.distributions
    .filter((d) => d.date.getTime() >= monthStart.getTime() && d.date.getTime() <= asOf.getTime())
    .reduce((s, d) => s + n((d as { totalAmount: unknown }).totalAmount), 0);

  return {
    month,
    generatedAt: iso(new Date()),
    cutoff: iso(asOf),
    poolCode: poolRaw.code,
    poolName: poolRaw.name,
    currency: poolRaw.currency,
    kpis: {
      unitPar: n(poolRaw.unitPrice),
      navPerUnit: cur.navR.navPerUnit,
      navPerUnitPrev: prev.navR.navPerUnit,
      endPerUnitNet: cur.endNet.endPerUnitNet,
      irrLive: cur.live.irr,
      irrPlan: cur.simKpis?.irrAnnual ?? null,
      housesStarted: cur.pool.houses.filter((h) => (h as { status: string }).status !== "PLANNED").length,
      housesTotal: cur.pool.houses.length,
      sold: cur.pool.houses.filter((h) => (h as { saleDate: unknown }).saleDate != null).length,
      raised: round2(cur.raised),
      target: targetN,
      pctRaised: targetN && targetN > 0 ? Math.round((cur.raised / targetN) * 100) : null,
      runwayMonths: cur.risk.runwayMonths,
      nextDist,
    },
    narrative,
    final: finalData,
    events: monthEvents.map((e) => ({ date: iso(e.date), icon: e.icon, text: e.text })),
    cascade: cur.endNet.lines,
    chart: {
      par: n(poolRaw.unitPrice),
      today: cur.navR.navPerUnit,
      end: cur.endNet.endPerUnitNet,
      startLabel: poolRaw.startDate ? iso(poolRaw.startDate) : "",
      endLabel: poolRaw.effectiveEndDate
        ? iso(poolRaw.effectiveEndDate)
        : poolRaw.plannedEndDate
          ? iso(poolRaw.plannedEndDate)
          : "",
    },
    schedule,
    risk: {
      freeCash: cur.risk.freeCash,
      monthlyInterest: cur.risk.monthlyToday,
      callMin: cur.risk.callMin90d,
      callSuff: cur.risk.callSufficiency,
      breakevenPct: cur.risk.breakevenPct,
      stress: cur.risk.scenarios
        .filter((s) => !s.base)
        .map((s) => ({ label: s.label, profit: s.profit, tone: s.tone })),
    },
    market: { green, amber, red, notes: notes.slice(0, 6) },
    dist: {
      inMonth: round2(distInMonth),
      cumulative: round2(cur.distributed),
      queueCount: cur.risk.queue.length,
      queueTotal: round2(cur.risk.queue.reduce((s, q) => s + q.total, 0)),
      queueCapital: round2(cur.risk.queue.reduce((s, q) => s + q.capital, 0)),
      queueProfit: round2(cur.risk.queue.reduce((s, q) => s + q.profit, 0)),
      capitalReturned: round2(
        cur.pool.distributions.filter((d) => (d as { kind: string }).kind === "RETURN_OF_CAPITAL").reduce((s, d) => s + n((d as { totalAmount: unknown }).totalAmount), 0),
      ),
      raised: round2(cur.raised),
      perf: {
        agreedPct: cur.perf.agreedPct,
        paid: cur.perf.paid,
        provisioned: cur.perf.provisioned,
        waived: cur.perf.waived,
        waiveRemaining: cur.perf.waiveRemaining,
        payee: cur.perf.payeeName,
      },
      safeDistributable: computeDistributable({
        cash: cur.risk.freeCash,
        endNetLines: cur.endNet.lines,
        unsoldPlannedSales: cur.pool.houses.filter((h) => (h as { saleDate: unknown }).saleDate == null).reduce((s, h) => s + n((h as { plannedSalePrice: unknown }).plannedSalePrice), 0),
        unsoldCount: cur.pool.houses.filter((h) => (h as { saleDate: unknown }).saleDate == null).length,
        openLoans: 0,
      }).safe,
    },
  };
}
