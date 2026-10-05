import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney, sum } from "@/lib/money";
import { PoolHouseTimeline, type HouseView } from "@/components/pool-house-timeline";
import { AddChangeOrderForm } from "@/components/pool-capital-forms";
import { deleteChangeOrder, deleteHouse } from "@/lib/actions/pools";
import { HouseMilestonesPanel } from "@/components/house-milestones-panel";
import { drawableFromBudget, estimatedDrawable, milestonePct, milestoneRows, type BudgetLine, type HouseMilestones, type MilestoneCatalog } from "@/lib/pools/milestones";
import { buildHouseLedger, houseCashTotals } from "@/lib/pools/house-cash";

export const dynamic = "force-dynamic";

const s = (v: { toString(): string } | null) => v?.toString() ?? "";
const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : "");
const num = (v: { toString(): string } | null) => (v == null ? null : Number(v));

export default async function PoolHousePage({
  params,
}: {
  params: Promise<{ id: string; houseId: string }>;
}) {
  const { id, houseId } = await params;
  const house = await prisma.poolHouse.findUnique({
    where: { id: houseId },
    include: {
      pool: { include: { loans: { orderBy: { createdAt: "asc" }, include: { bankProfile: true } } } },
      catalogModel: { select: { name: true } },
      catalogLocation: { select: { name: true } },
      changeOrders: { orderBy: { date: "asc" } },
      loanEntries: { where: { type: "DRAW" }, orderBy: { date: "asc" } },
      loan: { include: { bankProfile: true, entries: { where: { pending: false }, select: { amount: true, type: true } } } },
      budgetLines: { select: { milestoneKey: true, pct: true } },
      cashEntries: { orderBy: [{ opening: "desc" }, { date: "asc" }, { createdAt: "asc" }] },
    },
  });
  if (!house || house.poolId !== id) notFound();

  const [modelLocations, locations] = await Promise.all([
    prisma.catalogModelLocation.findMany({
      include: { model: { select: { name: true } } },
      orderBy: { model: { name: "asc" } },
    }),
    prisma.catalogLocation.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
  ]);
  const coTotal = Number(sum(house.changeOrders.map((c) => c.amount)));
  const cur = house.pool.currency;

  // marcos de construção (#73): catálogo + % + draw estimado
  const milestoneCatalog: MilestoneCatalog[] = (
    await prisma.catalogBuildMilestone.findMany({ orderBy: { sortOrder: "asc" } })
  ).map((r) => ({ key: r.key, name: r.name, detail: r.detail, weightPct: Number(r.weightPct), sortOrder: r.sortOrder }));
  const doneMilestones = house.milestones as HouseMilestones | null;
  const mPctRaw = milestonePct(milestoneCatalog, doneMilestones);
  const loanAmount = house.bankLoanAmount != null ? Number(house.bankLoanAmount) : 0;
  const alreadyDrawn = house.loanEntries.reduce(
    (acc, e) => acc + (e.pending ? Number(e.requestedAmount ?? 0) : Number(e.amount)),
    0,
  );
  const drawn = house.loanEntries.filter((e) => !e.pending).reduce((acc, e) => acc + Number(e.amount), 0);
  // casas antigas sem marco: % de obra cai para CO = 100% ou sacado ÷ aprovado (mesma régua do status)
  const drawnPct = loanAmount > 0 ? Math.min(100, Math.round((alreadyDrawn / loanAmount) * 100)) : 0;
  const mPctSource: "MILESTONES" | "DRAWS" | "CO" =
    mPctRaw != null ? "MILESTONES" : house.coDate != null ? "CO" : "DRAWS";
  const mPct = mPctRaw ?? (house.coDate != null ? 100 : drawnPct);
  const estimate = estimatedDrawable({ pct: mPct, loanAmount, alreadyDrawn });
  const budget: BudgetLine[] = house.budgetLines.map((b) => ({ milestoneKey: b.milestoneKey, pct: Number(b.pct) }));
  const real = drawableFromBudget({
    done: doneMilestones, budget, loanAmount,
    retainagePct: house.loan?.retainagePct != null ? Number(house.loan.retainagePct) : null,
    alreadyDrawn, coDone: house.coDate != null,
  });
  const drawEst = real.hasBudget
    ? { expectedCumulative: real.expectedCumulative, toRequest: real.toRequest }
    : estimate;
  const mRows = milestoneRows(milestoneCatalog, doneMilestones);

  // extrato da casa (05/10): lançamentos + draws + venda; o cache (ownCapital/lote/obra) já
  // reflete a soma — aqui só montamos as linhas
  const totals = houseCashTotals(house.cashEntries);
  const ledger = buildHouseLedger({
    entries: house.cashEntries,
    draws: house.loanEntries.map((e) => ({ date: e.date, amount: e.amount, memo: e.memo, pending: e.pending })),
    sale: { date: house.saleDate, netReceived: house.netReceived },
  });

  // loan da casa: estado p/ a etapa Funding e p/ sugerir payoff $0 quando já quitado
  const loanBalance = house.loan ? house.loan.entries.reduce((acc, e) => acc + Number(e.amount), 0) : 0;
  const loanInfo: HouseView["loanInfo"] = house.loan
    ? {
        label: `${house.loan.bankProfile?.name ?? "Banco a definir"}${house.loan.loanNumber ? ` · ${house.loan.loanNumber}` : ""}`,
        closingDate: d(house.loan.closingDate),
        apr: house.loan.aprPct != null ? Number(house.loan.aprPct) : house.loan.bankProfile?.aprPct != null ? Number(house.loan.bankProfile.aprPct) : null,
        paidOff: house.loan.entries.length > 0 && house.loan.entries.some((e) => e.type === "PAYOFF") && loanBalance <= 0.01,
        balance: Math.round(loanBalance * 100) / 100,
      }
    : null;

  const view: HouseView = {
    id: house.id,
    poolId: house.poolId,
    crumb: `${house.pool.code}${house.pool.alias ? ` · ${house.pool.alias}` : ""} · Casas`,
    currency: cur,
    address: house.address,
    status: house.status,
    modelName: house.catalogModel?.name ?? null,
    locationName: house.catalogLocation?.name ?? null,
    catalogModelId: house.catalogModelId ?? "",
    catalogLocationId: house.catalogLocationId ?? "",
    catalog: {
      locations,
      modelLocations: modelLocations.map((ml) => ({ locationId: ml.locationId, modelId: ml.modelId, modelName: ml.model.name })),
    },
    loanId: house.loanId ?? "",
    loans: house.pool.loans.map((l) => ({
      id: l.id,
      label: `${l.bankProfile?.name ?? "Banco a definir"}${l.loanNumber ? ` · ${l.loanNumber}` : ""}`,
    })),
    loanInfo,
    bank: {
      bankName: house.bankName ?? "",
      bankLoanAmount: s(house.bankLoanAmount),
      bankOriginationFee: s(house.bankOriginationFee),
      bankInterestReserve: s(house.bankInterestReserve),
      bankCashToClose: s(house.bankCashToClose),
      bankBudgetReviewFee: s(house.bankBudgetReviewFee),
      bankCharges: s(house.bankCharges),
    },
    pinLocation: house.pinLocation ?? "",
    lockboxCode: house.lockboxCode ?? "",
    notes: house.notes ?? "",
    planned: {
      lot: num(house.plannedLotCost), build: num(house.plannedBuildCost),
      sale: num(house.plannedSalePrice), closing: num(house.plannedClosingCost),
    },
    actual: {
      lot: num(house.actualLotCost), build: num(house.actualBuildCost), otherCosts: totals.otherCosts,
      ownCapital: num(house.ownCapital), sale: num(house.soldPrice), payoff: num(house.payoffAmount),
      net: num(house.netReceived), closing: num(house.closingCost),
    },
    coTotal,
    coCount: house.changeOrders.length,
    draws: house.loanEntries.map((e) => ({ date: d(e.date), amount: Number(e.amount), memo: e.memo, pending: e.pending })),
    drawn,
    buildPct: house.status === "UNDER_CONSTRUCTION" ? mPct : null,
    milestonesDone: mRows.filter((r) => r.done).length,
    milestonesTotal: mRows.length,
    dates: {
      lotContractDate: d(house.lotContractDate), lotPaidDate: d(house.lotPaidDate),
      permitAppliedDate: d(house.permitAppliedDate), permitIssuedDate: d(house.permitIssuedDate),
      buildStartDate: d(house.buildStartDate), coDate: d(house.coDate), listedDate: d(house.listedDate),
      contractDate: d(house.contractDate), saleDate: d(house.saleDate),
    },
    ledger,
    distributionsHref: `/pools/${id}?tab=investors&sub=distributions`,
    loanHref: `/pools/${id}/loan`,
  };

  return (
    <div className="max-w-7xl">
      {/* os 3 nós server-rendered levam key explícita: sem ela o React 19 avisa "missing key"
          ao reconciliá-los dentro do client component (elemento vindo de outro owner) */}
      <PoolHouseTimeline
        h={view}
        milestones={
          <HouseMilestonesPanel
            key="milestones"
            houseId={house.id}
            rows={mRows}
            pct={mPct ?? 0}
            loanAmount={loanAmount}
            hasLoan={!!house.loanId}
            expectedCumulative={drawEst.expectedCumulative}
            toRequest={drawEst.toRequest}
            alreadyDrawn={alreadyDrawn}
            usingBudget={real.hasBudget}
            retained={real.retained}
            pctSource={mPctSource}
            loanSettled={loanAmount > 0 && alreadyDrawn >= loanAmount - 0.01}
          />
        }
        changeOrders={
          <div key="change-orders" className="rounded-lg border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-4 py-2.5">
              <p className="text-[11px] text-slate-400">
                Alteram o valor do contrato da obra; o total entra no lucro real. Se o total do pool
                passar do captado, gere a chamada de capital na aba Investidores.
              </p>
            </div>
            {house.changeOrders.length > 0 && (
              <div className="divide-y divide-slate-50">
                {house.changeOrders.map((co) => (
                  <div key={co.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <span className="text-slate-500">{co.date.toISOString().slice(0, 10)}</span>
                    <span className="flex-1 px-4 font-medium text-slate-700">{co.description}</span>
                    <span className={`tabular-nums ${Number(co.amount) < 0 ? "text-emerald-700" : "text-slate-800"}`}>
                      {formatMoney(co.amount, cur)}
                    </span>
                    <form action={deleteChangeOrder} className="ml-3">
                      <input type="hidden" name="changeOrderId" value={co.id} />
                      <button type="submit" className="text-xs text-slate-300 hover:text-red-500">✕</button>
                    </form>
                  </div>
                ))}
              </div>
            )}
            <div className="border-t border-slate-100 px-4 py-3">
              <AddChangeOrderForm houseId={house.id} />
            </div>
          </div>
        }
        dangerZone={
          <details key="danger-zone" className="mt-3">
            <summary className="cursor-pointer text-xs text-slate-400 hover:text-red-600">Apagar esta casa…</summary>
            <div className="mt-2 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <p className="flex-1 text-xs text-red-800">
                Remove a casa e o realizado dela deste pool (extrato, change orders e vínculos de draws
                incluídos). Não tem desfazer.
              </p>
              <form action={deleteHouse}>
                <input type="hidden" name="houseId" value={house.id} />
                <button
                  type="submit"
                  className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                >
                  Apagar casa
                </button>
              </form>
            </div>
          </details>
        }
      />
    </div>
  );
}
