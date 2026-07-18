/**
 * Risco & caixa futuro (Fase 2 investor-grade, mock aprovado 18/07/2026): runway do
 * caixa, juros hoje×pico por loan, breakeven+stress e fila de distribuições estimadas
 * pelas vendas do baseline congelado. Módulo puro e FONTE ÚNICA — o card do Overview,
 * o KPI "Próx. distribuição" da régua, a aba Provisão & risco, o report mensal e o
 * portal usam a mesma conta. Tudo derivado do que já existe; estimativas levam ≈ na UI.
 */

import {
  computeSuffAggs,
  poolLoanSurplus,
  type SuffHouseInput,
  type SuffLoanInput,
} from "./loan-sufficiency";

type Dec = unknown;
const n = (v: Dec) => (v == null ? 0 : Number(v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export type RiskPoolInput = {
  targetAmount: Dec;
  scheduleBaseline: unknown;
  houses: Array<
    SuffHouseInput & {
      plannedClosingCost: Dec;
      plannedSalePrice: Dec;
      saleDate: Date | null;
      netReceived: Dec;
      soldPrice: Dec;
      payoffAmount: Dec;
      closingCost: Dec;
    }
  >;
  loans: Array<SuffLoanInput & { interestDueDay: number | null }>;
  members: Array<{ entries: Array<{ kind: string; amount: Dec }> }>;
  distributions: Array<{ totalAmount: Dec }>;
  expenses: Array<{ amount: Dec; status: string }>;
};

export type RiskLoanRow = {
  label: string;
  quitado: boolean;
  awaitingClosing: boolean;
  houses: number;
  balance: number;
  aprPct: number | null;
  monthlyToday: number; // juros/mês sobre o saldo de hoje
  peakPrincipal: number; // Σ drawable (tudo sacado)
  monthlyPeak: number;
  comingInterest: number; // jurosEst da suficiência (até o payoff do baseline)
};

export type RiskDisbursement = { label: string; amount: number; cashAfter: number };
export type RiskScenario = { label: string; profit: number; delta: number; tone: "green" | "amber" | "red"; base: boolean };
export type RiskMargin = { addr: string; cost: number; sale: number; marginPct: number; tone: "green" | "amber" | "red" };
export type RiskQueueItem = { date: Date | null; addr: string; capital: number; profit: number; total: number; cumulative: number };

export type RiskResult = {
  freeCash: number;
  loans: RiskLoanRow[];
  monthlyToday: number;
  monthlyPeak: number;
  comingInterestTotal: number;
  runwayMonths: number | null; // null = sem juros correndo
  disbursements: RiskDisbursement[];
  callMin90d: number | null; // capital call mínimo p/ 90 dias de juros
  callSufficiency: number | null; // aporte que fecha a conta da suficiência
  grossProfit: number;
  financingDrag: number;
  profitNet: number;
  salesTotal: number;
  breakevenPct: number | null; // quanto as vendas podem cair antes do lucro líq. zerar
  scenarios: RiskScenario[];
  margins: RiskMargin[];
  queue: RiskQueueItem[];
  next: RiskQueueItem | null;
};

const MES_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const mesAno = (d: Date) => `${MES_PT[d.getUTCMonth()]}/${d.getUTCFullYear()}`;

export function buildRisk(pool: RiskPoolInput, today: Date): RiskResult {
  // ── caixa disponível (mesma cascata do Overview) ──
  const raised = pool.members
    .flatMap((m) => m.entries)
    .reduce((s, e) => s + (e.kind === "TRANSFER_OUT" ? -1 : 1) * n(e.amount), 0);
  const received = pool.houses.reduce(
    (s, h) =>
      s +
      (h.netReceived != null
        ? n(h.netReceived)
        : h.soldPrice != null
          ? n(h.soldPrice) - n(h.payoffAmount) - n(h.closingCost)
          : 0),
    0,
  );
  const spent = pool.houses.reduce((s, h) => s + n(h.ownCapital), 0);
  const expensesPaid = pool.expenses.filter((e) => e.status === "PAID").reduce((s, e) => s + n(e.amount), 0);
  const provisioned = pool.expenses.filter((e) => e.status === "PROVISIONED").reduce((s, e) => s + n(e.amount), 0);
  const distributed = pool.distributions.reduce((s, d) => s + n(d.totalAmount), 0);
  const freeCash = round2(raised + received - spent - expensesPaid - distributed - provisioned);

  // ── juros por loan: hoje × pico (suficiência é a fonte do "por vir") ──
  const aggs = computeSuffAggs(pool, today);
  const aggById = new Map(aggs.map((a) => [a.loanId, a]));
  const loans: RiskLoanRow[] = pool.loans.map((l) => {
    const a = aggById.get(l.id);
    const lHouses = pool.houses.filter((h) => h.loanId === l.id);
    const balance = Math.max(0, l.entries.filter((e) => !e.pending).reduce((s, e) => s + n(e.amount), 0));
    const apr = a?.aprL ?? null;
    const quitado = a?.quitado ?? false;
    const peakPrincipal = lHouses.reduce((s, h) => s + n(h.bankLoanAmount), 0);
    return {
      label: l.bankProfile?.name?.split(" ")[0] ?? "Banco",
      quitado,
      awaitingClosing: !l.closingDate,
      houses: lHouses.length,
      balance: round2(balance),
      aprPct: apr,
      monthlyToday: quitado || apr == null ? 0 : round2((apr / 100 / 12) * balance),
      peakPrincipal: round2(peakPrincipal),
      monthlyPeak: quitado || apr == null ? 0 : round2((apr / 100 / 12) * peakPrincipal),
      comingInterest: round2(a?.jurosEst ?? 0),
    };
  });
  const active = loans.filter((l) => !l.quitado);
  const monthlyToday = round2(active.reduce((s, l) => s + l.monthlyToday, 0));
  const monthlyPeak = round2(active.reduce((s, l) => s + l.monthlyPeak, 0));
  const comingInterestTotal = round2(active.reduce((s, l) => s + l.comingInterest, 0));
  const runwayMonths = monthlyToday > 0 ? round2(Math.max(0, freeCash) / monthlyToday) : null;

  // próximos desembolsos: mês seguinte por loan + o mês depois agregado (saldo cresce)
  const disbursements: RiskDisbursement[] = [];
  {
    let cash = freeCash;
    const m1 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
    const m2 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 2, 1));
    for (const l of active.filter((x) => x.monthlyToday > 0)) {
      cash = round2(cash - l.monthlyToday);
      const due = pool.loans.find((x) => (x.bankProfile?.name?.split(" ")[0] ?? "Banco") === l.label)?.interestDueDay;
      disbursements.push({
        label: `${mesAno(m1)} — juros ${l.label}${due ? ` (venc. ~dia ${due})` : ""}`,
        amount: l.monthlyToday,
        cashAfter: cash,
      });
    }
    if (monthlyToday > 0) {
      cash = round2(cash - monthlyToday);
      disbursements.push({
        label: `${mesAno(m2)} — juros ${active
          .filter((x) => x.monthlyToday > 0)
          .map((x) => x.label)
          .join(" + ")} (saldo cresce c/ draws)`,
        amount: monthlyToday,
        cashAfter: cash,
      });
    }
  }
  const callMin90d = monthlyToday > 0 ? round2(3 * monthlyToday) : null;

  // ── breakeven & stress (casas não vendidas; drag do financiamento é do pool) ──
  const unsold = pool.houses.filter((h) => h.saleDate == null);
  const houseEco = unsold.map((h) => {
    const cost = n(h.plannedLotCost) + n(h.plannedBuildCost) + n(h.plannedClosingCost);
    const sale = h.plannedSalePrice != null ? n(h.plannedSalePrice) : null;
    return { h, cost, sale, profit: sale != null && cost > 0 ? sale - cost : null };
  });
  const grossProfit = round2(houseEco.reduce((s, e) => s + (e.profit ?? 0), 0));
  // só casas com custo E venda planejados entram no stress — sem base, −5% viraria
  // prejuízo inventado (caso PH-3: casa restante sem custo cadastrado)
  const salesTotal = round2(houseEco.reduce((s, e) => s + (e.profit != null ? (e.sale ?? 0) : 0), 0));
  const financingIncurred = pool.loans
    .flatMap((l) => l.entries)
    .filter((e) => !e.pending && ["CLOSING_FEE", "RESERVE", "DRAW_FEE", "INTEREST"].includes(e.type))
    .reduce((s, e) => s + n(e.amount), 0);
  const financingProjected = aggs.filter((a) => !a.quitado).reduce((s, a) => s + a.jurosEst + a.drawFeeEst, 0);
  const financingDrag = round2(financingIncurred + financingProjected);
  const profitNet = round2(Math.max(0, grossProfit - financingDrag));
  const scale = grossProfit > 0 ? profitNet / grossProfit : 0;
  const breakevenPct = salesTotal > 0 && profitNet > 0 ? round2((profitNet / salesTotal) * 100) : null;

  const tone = (profit: number): "green" | "amber" | "red" =>
    profit < 0 ? "red" : profit < 0.3 * profitNet ? "amber" : "green";
  const sc = (label: string, profit: number, base = false): RiskScenario => ({
    label,
    profit: round2(profit),
    delta: round2(profit - profitNet),
    tone: base ? "green" : tone(profit),
    base,
  });
  const scenarios: RiskScenario[] = [
    sc("Plano (baseline)", profitNet, true),
    sc("Vendas −5%", profitNet - 0.05 * salesTotal),
    sc("Vendas −10%", profitNet - 0.1 * salesTotal),
    sc("Atraso +3 meses", profitNet - 3 * monthlyPeak),
    sc("Atraso +6 meses", profitNet - 6 * monthlyPeak),
    sc("Vendas −10% e +6 meses", profitNet - 0.1 * salesTotal - 6 * monthlyPeak),
  ];

  const margins: RiskMargin[] = houseEco
    .filter((e) => e.sale != null && e.cost > 0)
    .map((e) => {
      const pct = ((e.sale! - e.cost) / e.sale!) * 100;
      return {
        addr: e.h.address.split(",")[0],
        cost: round2(e.cost),
        sale: round2(e.sale!),
        marginPct: round2(pct),
        tone: pct < 5 ? ("red" as const) : pct < 12 ? ("amber" as const) : ("green" as const),
      };
    })
    .sort((a, b) => a.marginPct - b.marginPct);

  // ── fila de distribuições estimadas (vendas do baseline congelado) ──
  const baselineSaleByHouse = (() => {
    const b = pool.scheduleBaseline as { houses?: Array<{ houseId: string; sale: string | null }> } | null;
    return new Map((b?.houses ?? []).map((x) => [x.houseId, x.sale ? new Date(x.sale) : null]));
  })();
  const queue: RiskQueueItem[] = houseEco
    .map((e) => {
      const profit = round2((e.profit ?? 0) * scale);
      const capital = round2(n(e.h.ownCapital));
      return {
        date: baselineSaleByHouse.get(e.h.id) ?? null,
        addr: e.h.address.split(",")[0],
        capital,
        profit,
        total: round2(capital + profit),
        cumulative: 0,
      };
    })
    .sort((a, b) => (a.date?.getTime() ?? Infinity) - (b.date?.getTime() ?? Infinity));
  let cum = 0;
  for (const q of queue) {
    cum = round2(cum + q.total);
    q.cumulative = cum;
  }
  const next = queue.find((q) => q.date != null) ?? queue[0] ?? null;

  return {
    freeCash,
    loans,
    monthlyToday,
    monthlyPeak,
    comingInterestTotal,
    runwayMonths,
    disbursements,
    callMin90d,
    callSufficiency: (() => {
      const target = pool.targetAmount != null ? n(pool.targetAmount) : null;
      if (target == null) return null;
      const shortfall = Math.max(0, target - raised);
      if (shortfall <= 0) return null;
      const liq = Math.max(0, shortfall - poolLoanSurplus(aggs));
      return liq > 0.01 ? round2(liq) : null;
    })(),
    grossProfit,
    financingDrag,
    profitNet,
    salesTotal,
    breakevenPct,
    scenarios,
    margins,
    queue,
    next,
  };
}
