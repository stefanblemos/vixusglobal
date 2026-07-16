import { prisma } from "@/lib/db";
import {
  deriveHouseStatus,
  derivePoolStatus,
  type HouseStatusValue,
  type PoolStatusValue,
} from "@/lib/pools/status-derive";

/**
 * Recomputa e PERSISTE os status derivados de um pool (casas + vida do pool).
 * Chamado nos write-paths (salvar ficha, draw, payoff, documento aplicado, distribuição)
 * e no self-healing da página do pool — o campo persistido é só cache dos fatos.
 */
export async function recomputePoolStatuses(poolId: string): Promise<{
  poolStatus: PoolStatusValue;
  changedHouses: number;
}> {
  const pool = await prisma.investmentPool.findUnique({
    where: { id: poolId },
    include: {
      houses: true,
      members: { include: { entries: true } },
      distributions: { orderBy: { date: "asc" } },
      expenses: true,
      loans: { include: { entries: { where: { pending: false } } } },
    },
  });
  if (!pool) return { poolStatus: "FUNDING", changedHouses: 0 };

  // draws creditados e payoff por casa (fatos do statement)
  const drawsByHouse = new Map<string, number>();
  const payoffByHouse = new Set<string>();
  for (const loan of pool.loans)
    for (const e of loan.entries) {
      if (!e.houseId) continue;
      if (e.type === "DRAW") drawsByHouse.set(e.houseId, (drawsByHouse.get(e.houseId) ?? 0) + Number(e.amount));
      if (e.type === "PAYOFF") payoffByHouse.add(e.houseId);
    }

  let changedHouses = 0;
  const statuses: HouseStatusValue[] = [];
  for (const h of pool.houses) {
    const derived = deriveHouseStatus(h, drawsByHouse.get(h.id) ?? 0, payoffByHouse.has(h.id));
    statuses.push(derived);
    if (derived !== h.status) {
      await prisma.poolHouse.update({ where: { id: h.id }, data: { status: derived } });
      changedHouses++;
    }
  }

  // loans quitados: todo loan com atividade fechou o saldo (soma dos lançamentos ≤ 0)
  const allLoansPaidOff = pool.loans.every((l) => {
    if (l.entries.length === 0) return true;
    const balance = l.entries.reduce((s, e) => s + Number(e.amount), 0);
    return balance <= 0.01;
  });

  // caixa livre p/ devolução — mesmas fórmulas da Overview
  const raised = pool.members
    .flatMap((m) => m.entries)
    .reduce((s, e) => s + (e.kind === "TRANSFER_OUT" ? -1 : 1) * Number(e.amount), 0);
  const spentOnHouses = pool.houses.reduce((s, h) => s + Number(h.ownCapital ?? 0), 0);
  const receivedFromSales = pool.houses.reduce((s, h) => {
    if (h.netReceived != null) return s + Number(h.netReceived);
    if (h.soldPrice != null)
      return s + Number(h.soldPrice) - Number(h.payoffAmount ?? 0) - Number(h.closingCost ?? 0);
    return s;
  }, 0);
  const expensesPaid = pool.expenses
    .filter((e) => e.status === "PAID")
    .reduce((s, e) => s + Number(e.amount), 0);
  const expensesProvisioned = pool.expenses
    .filter((e) => e.status === "PROVISIONED")
    .reduce((s, e) => s + Number(e.amount), 0);
  const distributed = pool.distributions.reduce((s, d) => s + Number(d.totalAmount), 0);
  const freeToReturn =
    raised + receivedFromSales - spentOnHouses - expensesPaid - distributed - expensesProvisioned;

  const poolStatus = derivePoolStatus({
    houseStatuses: statuses,
    allLoansPaidOff,
    hasProfitDistribution: pool.distributions.some((d) => d.kind === "PROFIT"),
    freeToReturn,
  });
  if (poolStatus !== pool.status) {
    await prisma.investmentPool.update({
      where: { id: poolId },
      data: {
        status: poolStatus,
        // término real carimbado no fechamento (data da última distribuição)
        ...(poolStatus === "CLOSED" && pool.effectiveEndDate == null
          ? { effectiveEndDate: pool.distributions[pool.distributions.length - 1]?.date ?? new Date() }
          : {}),
      },
    });
  }
  return { poolStatus, changedHouses };
}
