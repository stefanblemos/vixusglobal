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
import { computeNav, liveIrr, type NavHouse } from "./nav";
import { buildRisk } from "./risk";
import { computeEndNet } from "./investor-value";
import { buildActivityFeed } from "./activity-feed";
import { ncStatsForLocation } from "./benchmark";
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
  };
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
function metricsAt(poolRaw: any, asOf: Date) {
  const pool = poolAt(poolRaw, asOf) as PoolView;
  const raised = pool.members
    .flatMap((m) => m.entries)
    .reduce((s, e) => s + ((e as { kind: string }).kind === "TRANSFER_OUT" ? -1 : 1) * n((e as { amount: unknown }).amount), 0);
  const received = pool.houses.reduce((s, h) => {
    const hh = h as { netReceived: unknown; soldPrice: unknown; payoffAmount: unknown; closingCost: unknown };
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
      buildPct: hh.coDate ? 100 : drawable && drawable > 0 ? Math.min(100, (drawn / drawable) * 100) : 0,
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
    hasEntity: pool.companyId != null,
    hasWindDownProvision: pool.expenses.some((e) => (e as { category: string }).category === "DISSOLUTION"),
    raised,
    distributed,
    investorProfitSharePct: pool.profitSharePct != null ? n(pool.profitSharePct) : null,
    promotePlan: simKpis?.promoteTotal ?? null,
    vehicleCostPlan: simKpis?.vehicleCostTotal ?? null,
    expensesPaid,
    unitsTotal,
  });
  return { pool, risk, navR, live, endNet, raised, distributed, simKpis, unitsTotal };
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
        },
      },
      members: { include: { entries: true, party: true, company: true } },
      distributions: { orderBy: { date: "asc" }, include: { lines: true } },
      expenses: true,
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
  const asOf = monthEnd.getTime() < now.getTime() ? monthEnd : now;

  const cur = metricsAt(poolRaw, asOf);
  const prev = metricsAt(poolRaw, new Date(Date.UTC(y, m - 1, 0, 23, 59, 59)));

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
    },
  };
}
