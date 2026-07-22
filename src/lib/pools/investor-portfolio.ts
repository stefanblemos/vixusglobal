/**
 * Portfólio consolidado do investidor (Fase 4, mock v2 aprovado 19/07/2026): a mesma
 * entidade (empresa/pessoa) em N pools = uma tela só, com os números DELA pro-rata.
 * Consolidação por chave c_<companyId> | p_<partyId>. O portal futuro é esta carga +
 * login mapeando usuário → entidade. Server-only (prisma); contas nos módulos puros
 * (nav, risk, investor-value, activity-feed).
 */

import { prisma } from "@/lib/db";
import { computeNav, liveIrr, xirr, type NavHouse } from "./nav";
import { buildRisk, type RiskResult } from "./risk";
import { computeEndNet, type EndNetResult } from "./investor-value";
import { buildActivityFeed, type FeedEvent } from "./activity-feed";
import { buildInvestorStatement, type StmtMovement, type StmtResult } from "./investor-statement";

const n = (v: unknown) => (v == null ? 0 : Number(v));
const round2 = (v: number) => Math.round(v * 100) / 100;

export type InvestorEntityRow = {
  key: string;
  name: string;
  pools: number;
  invested: number;
  units: number;
};

// Lista consolidada (leve) — /pools/investors
export async function listInvestorEntities(): Promise<InvestorEntityRow[]> {
  const members = await prisma.poolMember.findMany({
    select: {
      poolId: true,
      partyId: true,
      companyId: true,
      party: { select: { name: true } },
      company: { select: { legalName: true } },
      entries: { select: { kind: true, amount: true, units: true } },
    },
  });
  const map = new Map<string, InvestorEntityRow & { poolIds: Set<string> }>();
  for (const m of members) {
    const key = m.companyId ? `c_${m.companyId}` : m.partyId ? `p_${m.partyId}` : null;
    if (!key) continue;
    const name = m.company?.legalName ?? m.party?.name ?? "?";
    const invested = m.entries.reduce((s, e) => s + (e.kind === "TRANSFER_OUT" ? -1 : 1) * n(e.amount), 0);
    const units = m.entries.reduce((s, e) => s + (e.kind === "TRANSFER_OUT" ? -1 : 1) * n(e.units), 0);
    const row = map.get(key) ?? { key, name, pools: 0, invested: 0, units: 0, poolIds: new Set<string>() };
    row.poolIds.add(m.poolId);
    row.invested = round2(row.invested + invested);
    row.units = round2(row.units + units);
    map.set(key, row);
  }
  return [...map.values()]
    .map(({ poolIds, ...r }) => ({ ...r, pools: poolIds.size }))
    .sort((a, b) => b.invested - a.invested);
}

export type PortfolioPosition = {
  poolId: string;
  code: string;
  name: string;
  status: string;
  currency: string;
  units: number;
  pct: number; // participação nas units do pool
  invested: number;
  valueToday: number | null; // navPerUnit × units
  navPerUnit: number | null;
  endPerUnitNet: number | null;
  endShareNet: number | null;
  unitPar: number;
  startDate: Date | null;
  endDate: Date | null; // efetivo ?? planejado ?? última venda do baseline
  soldCount: number;
  housesCount: number;
  nextDist: { date: Date; share: number } | null; // pro-rata da 1ª venda da fila
  endNet: EndNetResult;
  distributedToInvestor: number;
  irr: number | null; // TIR do investidor NESTE pool (fluxos dele + projeção)
  roiProjected: number | null; // (projeção fim + distribuído) ÷ investido
};

export type InvestorPortfolio = {
  key: string;
  name: string;
  positions: PortfolioPosition[];
  invested: number;
  valueToday: number;
  endNet: number;
  distributed: number;
  irr: number | null; // XIRR dos fluxos DELE + projeção líquida
  tvpiToday: number | null;
  tvpiProjected: number | null;
  nextDist: { date: Date; share: number; poolCode: string } | null;
  feed: { events: Array<FeedEvent & { poolCode: string }>; total: number };
  statement: StmtResult; // extrato "conta bancária" (regra da carteira)
  memberIds: string[]; // PoolMember ids da entidade (tax center: docs por sócio)
};

export async function loadInvestorPortfolio(key: string): Promise<InvestorPortfolio | null> {
  const [kind, id] = [key.slice(0, 1), key.slice(2)];
  if ((kind !== "c" && kind !== "p") || !id) return null;
  const where = kind === "c" ? { companyId: id } : { partyId: id };
  // saldo de abertura (projetos anteriores encerrados) — credita a carteira
  const legacy = await prisma.investorLegacy.findFirst({ where });
  const opening = legacy
    ? {
        invested: Number(legacy.invested),
        returned: Number(legacy.returned),
        date: legacy.since,
        note: legacy.note,
      }
    : null;

  const pools = await prisma.investmentPool.findMany({
    where: { members: { some: where } },
    orderBy: { createdAt: "desc" },
    include: {
      company: { select: { id: true } },
      houses: {
        include: {
          catalogModel: { select: { name: true, sqft: true } },
          catalogLocation: { select: { name: true } },
          loanEntries: { where: { type: "DRAW", pending: false }, select: { amount: true } },
        },
      },
      members: { include: { entries: true, party: true, company: true } },
      distributions: { orderBy: { date: "asc" }, include: { lines: { include: { member: true } } } },
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
  if (pools.length === 0) return null;

  const today = new Date();
  const positions: PortfolioPosition[] = [];
  const flows: Array<{ date: Date; amount: number }> = [];
  const feedAll: Array<FeedEvent & { poolCode: string }> = [];
  const movements: StmtMovement[] = [];
  const memberIds: string[] = [];
  let feedTotal = 0;
  let investorName = "?";
  let distributedTotal = 0;

  for (const pool of pools) {
    const me = pool.members.find((m) => (kind === "c" ? m.companyId === id : m.partyId === id));
    if (!me) continue;
    investorName = me.company?.legalName ?? me.party?.name ?? investorName;

    const myUnits = me.entries.reduce((s, e) => s + (e.kind === "TRANSFER_OUT" ? -1 : 1) * n(e.units), 0);
    const myInvested = me.entries.reduce((s, e) => s + (e.kind === "TRANSFER_OUT" ? -1 : 1) * n(e.amount), 0);
    const unitsTotal = pool.members.reduce(
      (s, m) => s + m.entries.reduce((x, e) => x + (e.kind === "TRANSFER_OUT" ? -1 : 1) * n(e.units), 0),
      0,
    );
    const pct = unitsTotal > 0 ? myUnits / unitsTotal : 0;

    // cascata do caixa (mesma conta do Overview/risk)
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
    const provisioned = pool.expenses
      .filter((e) => e.status === "PROVISIONED")
      .reduce((s, e) => s + n(e.amount), 0);
    const distributed = pool.distributions.reduce((s, d) => s + n(d.totalAmount), 0);
    const available = raised + received - spent - expensesPaid - distributed;

    const risk: RiskResult = buildRisk(pool, today);
    const simKpis =
      (pool.simulations[0]?.result as { kpis?: Record<string, number | null> } | null)?.kpis ?? null;

    // NAV hoje (Fase 1) — mesmo desenho da página do pool
    const baselineSaleByHouse = (() => {
      const b = pool.scheduleBaseline as { houses?: Array<{ houseId: string; sale: string | null }> } | null;
      return new Map((b?.houses ?? []).map((h) => [h.houseId, h.sale ? new Date(h.sale) : null]));
    })();
    const navHouses: NavHouse[] = pool.houses.map((h) => {
      const drawn = h.loanEntries.reduce((s, e) => s + n(e.amount), 0);
      const cost = n(h.plannedLotCost) + n(h.plannedBuildCost) + n(h.plannedClosingCost);
      const expectedProfit = h.plannedSalePrice != null && cost > 0 ? n(h.plannedSalePrice) - cost : null;
      const drawable = h.bankLoanAmount != null ? n(h.bankLoanAmount) : null;
      return {
        ownCapital: n(h.ownCapital),
        bankDrawn: drawn,
        expectedProfit,
        buildPct: h.coDate ? 100 : drawable && drawable > 0 ? Math.min(100, (drawn / drawable) * 100) : 0,
        sold: h.saleDate != null,
        baselineSale: baselineSaleByHouse.get(h.id) ?? null,
      };
    });
    const debt = pool.loans.reduce(
      (s, l) => s + Math.max(0, l.entries.filter((e) => !e.pending).reduce((x, e) => x + n(e.amount), 0)),
      0,
    );
    const financingIncurred = pool.loans
      .flatMap((l) => l.entries)
      .filter((e) => !e.pending && ["CLOSING_FEE", "RESERVE", "DRAW_FEE", "INTEREST"].includes(e.type))
      .reduce((s, e) => s + n(e.amount), 0);
    const live = liveIrr({
      contributions: pool.members
        .flatMap((m) => m.entries)
        .filter((e) => e.kind === "CONTRIBUTION" || e.kind === "CAPITAL_CALL")
        .map((e) => ({ date: e.date, amount: n(e.amount) })),
      distributions: pool.distributions.map((d) => ({ date: d.date, amount: n(d.totalAmount) })),
      houses: navHouses,
      financingDrag: risk.financingDrag, // incorrido + por vir (mesma conta da Fase 2)
      today,
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

    // FIM líquido a mercado (Fase 4)
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
      // por vir = drag total − o já incorrido (juros/fees futuros da Fase 2)
      financingComing: Math.max(0, risk.financingDrag - financingIncurred),
      provisionedExpenses: provisioned,
      hasEntity: pool.companyId != null,
      hasWindDownProvision: pool.expenses.some((e) => e.category === "DISSOLUTION"),
      raised,
      distributed,
      investorProfitSharePct: pool.profitSharePct != null ? n(pool.profitSharePct) : null,
      promotePlan: simKpis?.promoteTotal ?? null,
      vehicleCostPlan: simKpis?.vehicleCostTotal ?? null,
      expensesPaid,
      unitsTotal,
    });

    // fluxos DELE: aportes/compras negativos, saídas/distribuições positivos + projeção;
    // e os mesmos eventos alimentam o extrato (carteira novo × reuso). Coletados por
    // pool p/ a TIR da POSIÇÃO (pedido 19/07: ROI e TIR claros em cada card).
    const poolFlows: Array<{ date: Date; amount: number }> = [];
    memberIds.push(me.id);
    for (const e of me.entries) {
      if (e.kind === "CONTRIBUTION" || e.kind === "CAPITAL_CALL" || e.kind === "TRANSFER_IN") {
        poolFlows.push({ date: e.date, amount: -Math.abs(n(e.amount)) });
        movements.push({
          type: e.kind,
          date: e.date,
          amount: n(e.amount),
          poolCode: pool.code,
          rollover: e.rolloverOfDistributionId != null,
          newMoneyOverride: e.newMoneyOverride,
          memo: e.memo,
        });
      } else if (e.kind === "TRANSFER_OUT") {
        poolFlows.push({ date: e.date, amount: Math.abs(n(e.amount)) });
        movements.push({
          type: "TRANSFER_OUT",
          date: e.date,
          amount: n(e.amount),
          poolCode: pool.code,
          memo: e.memo,
        });
      }
    }
    let myDistributed = 0;
    for (const d of pool.distributions)
      for (const l of d.lines)
        if (kind === "c" ? l.member.companyId === id : l.member.partyId === id) {
          poolFlows.push({ date: d.date, amount: n(l.amount) });
          myDistributed += n(l.amount);
          movements.push({
            type: d.kind === "PROFIT" ? "DIST_PROFIT" : "DIST_CAPITAL",
            date: d.date,
            amount: n(l.amount),
            poolCode: pool.code,
            memo: d.memo,
          });
        }
    distributedTotal += myDistributed;

    const endDate =
      pool.effectiveEndDate ??
      pool.plannedEndDate ??
      risk.queue.reduce<Date | null>((acc, q) => (q.date && (!acc || q.date > acc) ? q.date : acc), null);
    // projeção pro-rata: fila da Fase 2 nas datas do baseline; resto (caixa final) no endDate
    const queueTotal = risk.queue.reduce((s, q) => s + q.total, 0);
    for (const q of risk.queue)
      if (q.date) poolFlows.push({ date: q.date, amount: pct * q.total * (endNet.endValueNet > 0 && queueTotal > 0 ? Math.min(1, endNet.endValueNet / queueTotal) : 1) });
    const remainder = pct * Math.max(0, endNet.endValueNet - queueTotal);
    if (remainder > 0.01 && endDate) poolFlows.push({ date: endDate, amount: remainder });
    flows.push(...poolFlows);

    positions.push({
      poolId: pool.id,
      code: pool.code,
      name: pool.name,
      status: pool.status,
      currency: pool.currency,
      units: round2(myUnits),
      pct,
      invested: round2(myInvested),
      valueToday: navR.navPerUnit != null ? round2(navR.navPerUnit * myUnits) : null,
      navPerUnit: navR.navPerUnit,
      endPerUnitNet: endNet.endPerUnitNet,
      endShareNet: endNet.endPerUnitNet != null ? round2(endNet.endPerUnitNet * myUnits) : null,
      unitPar: n(pool.unitPrice),
      startDate: pool.startDate,
      endDate,
      soldCount: pool.houses.filter((h) => h.saleDate != null).length,
      housesCount: pool.houses.length,
      nextDist: risk.next?.date ? { date: risk.next.date, share: round2(pct * risk.next.total) } : null,
      endNet,
      distributedToInvestor: round2(myDistributed),
      irr: xirr(poolFlows),
      roiProjected:
        myInvested > 0 && endNet.endPerUnitNet != null
          ? round2((endNet.endPerUnitNet * myUnits + myDistributed) / myInvested)
          : null,
    });

    // feed do investidor: eventos do POOL + só os aportes DELE (nunca dos outros sócios)
    const houseAddrById = new Map(pool.houses.map((h) => [h.id, h.address]));
    const feed = buildActivityFeed(
      {
        members: [
          {
            name: investorName,
            entries: me.entries.map((e) => ({ kind: e.kind, date: e.date, amount: e.amount })),
          },
        ],
        loans: pool.loans.map((l) => ({
          bankName: l.bankProfile?.name ?? null,
          entries: l.entries.map((e) => ({
            type: e.type,
            date: e.date,
            amount: e.amount,
            pending: e.pending,
            houseAddress: e.houseId ? (houseAddrById.get(e.houseId) ?? null) : null,
          })),
        })),
        houses: pool.houses,
        distributions: pool.distributions.map((d) => ({
          date: d.date,
          amount: d.lines.reduce((s, l) => s + n(l.amount), 0),
        })),
        expenses: [],
        currency: pool.currency,
      },
      50,
    );
    feedAll.push(...feed.events.map((e) => ({ ...e, poolCode: pool.code })));
    feedTotal += feed.total;
  }

  const invested = round2(positions.reduce((s, p) => s + p.invested, 0));
  const valueToday = round2(positions.reduce((s, p) => s + (p.valueToday ?? 0), 0));
  const endNetTotal = round2(positions.reduce((s, p) => s + (p.endShareNet ?? 0), 0));
  const nextDist = positions
    .filter((p) => p.nextDist)
    .sort((a, b) => a.nextDist!.date.getTime() - b.nextDist!.date.getTime())[0];
  feedAll.sort((a, b) => b.date.getTime() - a.date.getTime());

  return {
    key,
    name: investorName,
    positions,
    invested,
    valueToday,
    endNet: endNetTotal,
    distributed: round2(distributedTotal),
    irr: xirr(flows),
    tvpiToday: invested > 0 ? round2((valueToday + distributedTotal) / invested) : null,
    tvpiProjected: invested > 0 ? round2((endNetTotal + distributedTotal) / invested) : null,
    nextDist: nextDist?.nextDist ? { ...nextDist.nextDist, poolCode: nextDist.code } : null,
    feed: { events: feedAll.slice(0, 12), total: feedTotal },
    statement: buildInvestorStatement(movements, opening),
    memberIds,
  };
}
