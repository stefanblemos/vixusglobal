import { prisma } from "@/lib/db";
import { buildRisk } from "./risk";
import { computeEndNet } from "./investor-value";
import { computeDistributable, performanceSummary, type Distributable, type PerformanceSummary } from "./distributable";

/**
 * Carrega o pool e calcula o teste de distribuível + resumo da performance no SERVER
 * (usado pela action de distribuição como gate, e pela aba). Espelha a conta da página do
 * pool / investor-portfolio: caixa = captado + recebido (só com closing) − capital nas casas
 * − despesas pagas − distribuído; reservas vêm da cascata do fim líquido (computeEndNet).
 */
const n = (v: unknown) => (v == null ? 0 : Number(v));

// asOf (06/10): o teste é feito na DATA da distribuição — caixa com os fatos até lá (aportes,
// vendas com closing, despesas pagas, distribuições anteriores). Reservas são as de hoje
// (conservador). Sem asOf = hoje.
export async function loadDistributable(poolId: string, asOf?: Date): Promise<{
  distributable: Distributable;
  perf: PerformanceSummary;
  cash: number;
  cashAsOf: number;
  profitRealized: number; // recebido − capital nas casas − despesas pagas (base do lucro, pool fechado)
}> {
  const pool = await prisma.investmentPool.findUniqueOrThrow({
    where: { id: poolId },
    include: {
      performancePayeeCompany: { select: { legalName: true } },
      performancePayeeParty: { select: { name: true } },
      houses: {
        include: {
          catalogModel: { select: { name: true, sqft: true } },
          catalogLocation: { select: { name: true } },
          loanEntries: { where: { type: "DRAW", pending: false }, select: { amount: true } },
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
  const today = new Date();
  const raised = pool.members.flatMap((m) => m.entries).reduce((s, e) => s + (e.kind === "TRANSFER_OUT" ? -1 : 1) * n(e.amount), 0);
  const received = pool.houses.reduce(
    (s, h) =>
      s +
      (h.saleDate == null ? 0 : h.netReceived != null ? n(h.netReceived) : h.soldPrice != null ? n(h.soldPrice) - n(h.payoffAmount) - n(h.closingCost) : 0),
    0,
  );
  const spent = pool.houses.reduce((s, h) => s + n(h.ownCapital), 0);
  const expensesPaid = pool.expenses.filter((e) => e.status === "PAID").reduce((s, e) => s + n(e.amount), 0);
  const provisioned = pool.expenses.filter((e) => e.status === "PROVISIONED").reduce((s, e) => s + n(e.amount), 0);
  const distributed = pool.distributions.reduce((s, d) => s + n(d.totalAmount), 0);
  const available = raised + received - spent - expensesPaid - distributed;
  // caixa NA DATA (capital nas casas conta inteiro — aberturas não têm data confiável)
  const cut = asOf ?? today;
  const le = (d: Date) => d.getTime() <= cut.getTime();
  const cashAsOf =
    pool.members.flatMap((m) => m.entries).filter((e) => le(e.date)).reduce((s, e) => s + (e.kind === "TRANSFER_OUT" ? -1 : 1) * n(e.amount), 0) +
    pool.houses.filter((h) => h.saleDate != null && le(h.saleDate)).reduce((s, h) => s + (h.netReceived != null ? n(h.netReceived) : n(h.soldPrice) - n(h.payoffAmount) - n(h.closingCost)), 0) -
    spent -
    pool.expenses.filter((e) => e.status === "PAID" && le(e.date)).reduce((s, e) => s + n(e.amount), 0) -
    pool.distributions.filter((d) => le(d.date)).reduce((s, d) => s + n(d.totalAmount), 0);

  const risk = buildRisk(pool as never, today);
  const simKpis = (pool.simulations[0]?.result as { kpis?: Record<string, number | null> } | null)?.kpis ?? null;
  const debt = pool.loans.reduce((s, l) => s + Math.max(0, l.entries.filter((e) => !e.pending).reduce((x, e) => x + n(e.amount), 0)), 0);
  const financingIncurred = pool.loans
    .flatMap((l) => l.entries)
    .filter((e) => !e.pending && ["CLOSING_FEE", "RESERVE", "DRAW_FEE", "INTEREST"].includes(e.type))
    .reduce((s, e) => s + n(e.amount), 0);
  const perf = performanceSummary(pool);
  const endNet = computeEndNet({
    freeCash: available,
    houses: pool.houses.map((h) => ({
      addr: h.address.split(",")[0],
      sold: h.saleDate != null,
      plannedLotCost: h.plannedLotCost != null ? n(h.plannedLotCost) : null,
      plannedBuildCost: h.plannedBuildCost != null ? n(h.plannedBuildCost) : null,
      plannedClosingCost: h.plannedClosingCost != null ? n(h.plannedClosingCost) : null,
      plannedSalePrice: h.plannedSalePrice != null ? n(h.plannedSalePrice) : null,
      ownCapital: n(h.ownCapital),
      bankDrawn: h.loanEntries.reduce((s, e) => s + n(e.amount), 0),
      drawable: h.bankLoanAmount != null ? n(h.bankLoanAmount) : null,
      locationName: h.catalogLocation?.name ?? null,
      sqft: h.catalogModel?.sqft ?? null,
    })),
    debt,
    financingComing: Math.max(0, risk.financingDrag - financingIncurred),
    provisionedExpenses: provisioned,
    hasEntity: pool.companyId != null,
    hasWindDownProvision: pool.expenses.some((e) => e.category === "DISSOLUTION"),
    raised,
    distributed,
    performancePct: perf.agreedPct,
    performanceSettled: perf.settled,
    performanceWaiveRemaining: perf.waiveRemaining,
    promotePlan: simKpis?.promoteTotal ?? null,
    vehicleCostPlan: simKpis?.vehicleCostTotal ?? null,
    expensesPaid,
    unitsTotal: pool.members.reduce((s, m) => s + m.entries.reduce((x, e) => x + (e.kind === "TRANSFER_OUT" ? -1 : 1) * n(e.units), 0), 0),
  });
  const unsold = pool.houses.filter((h) => h.saleDate == null);
  const distributable = computeDistributable({
    cash: asOf ? cashAsOf : available,
    endNetLines: endNet.lines,
    unsoldPlannedSales: unsold.reduce((s, h) => s + n(h.plannedSalePrice), 0),
    unsoldCount: unsold.length,
    openLoans: pool.loans.filter((l) => l.entries.filter((e) => !e.pending).reduce((s, e) => s + n(e.amount), 0) > 0.01).length,
  });
  return {
    distributable,
    perf,
    cash: Math.round(available * 100) / 100,
    cashAsOf: Math.round(cashAsOf * 100) / 100,
    profitRealized: Math.round((received - spent - expensesPaid) * 100) / 100,
  };
}
