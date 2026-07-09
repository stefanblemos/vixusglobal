import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney, sum } from "@/lib/money";
import { houseEconomics } from "@/lib/pools/math";
import { PoolHouseForm } from "@/components/pool-house-form";
import { AddChangeOrderForm } from "@/components/pool-capital-forms";
import { deleteChangeOrder } from "@/lib/actions/pools";

export const dynamic = "force-dynamic";

const s = (v: { toString(): string } | null) => v?.toString() ?? "";
const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : "");

export default async function PoolHousePage({
  params,
}: {
  params: Promise<{ id: string; houseId: string }>;
}) {
  const { id, houseId } = await params;
  const house = await prisma.poolHouse.findUnique({
    where: { id: houseId },
    include: {
      pool: true,
      changeOrders: { orderBy: { date: "asc" } },
      loanEntries: { where: { type: "DRAW" } },
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
  const drawsTotal = sum(house.loanEntries.map((e) => e.amount));
  const coTotal = sum(house.changeOrders.map((c) => c.amount));
  const eco = houseEconomics(house, coTotal);
  const cur = house.pool.currency;

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href={`/pools/${id}`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {house.pool.code}
          {house.pool.alias ? ` · ${house.pool.alias}` : ""}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">{house.address}</h1>
        <p className="text-sm text-slate-500">
          {eco.plannedProfit != null && (
            <>Planned profit {formatMoney(eco.plannedProfit, cur)} · </>
          )}
          {eco.ownCapitalNeeded != null && (
            <>own capital needed {formatMoney(eco.ownCapitalNeeded, cur)} · </>
          )}
          {eco.cashAtClosing != null && (
            <>recebido em conta {formatMoney(eco.cashAtClosing, cur)} · </>
          )}
          {!coTotal.isZero() && <>change orders {formatMoney(coTotal, cur)} · </>}
          {house.bankLoanAmount != null && (
            <>
              loan aprovado {formatMoney(house.bankLoanAmount, cur)} · draws{" "}
              {formatMoney(drawsTotal, cur)} (saldo do budget{" "}
              {formatMoney(Number(house.bankLoanAmount) - Number(drawsTotal), cur)}) ·{" "}
            </>
          )}
          {eco.realProfit != null && <>lucro (custo, c/ COs) {formatMoney(eco.realProfit, cur)}</>}
        </p>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-medium text-slate-800">
            Change orders {house.changeOrders.length > 0 && `(${house.changeOrders.length} · ${formatMoney(coTotal, cur)})`}
          </h2>
          <p className="text-xs text-slate-400">
            Despesas/créditos que alteram o valor do contrato. Se o total do pool passar do
            captado, gere a chamada de capital na aba Investidores do pool.
          </p>
        </div>
        {house.changeOrders.length > 0 && (
          <div className="divide-y divide-slate-50">
            {house.changeOrders.map((co) => (
              <div key={co.id} className="flex items-center justify-between px-5 py-2 text-sm">
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
        <div className="border-t border-slate-100 px-5 py-4">
          <AddChangeOrderForm houseId={house.id} />
        </div>
      </section>
      <PoolHouseForm
        catalog={{
          locations,
          modelLocations: modelLocations.map((ml) => ({
            locationId: ml.locationId,
            modelId: ml.modelId,
            modelName: ml.model.name,
          })),
        }}
        values={{
          id: house.id,
          poolId: house.poolId,
          address: house.address,
          status: house.status,
          catalogModelId: house.catalogModelId ?? "",
          catalogLocationId: house.catalogLocationId ?? "",
          plannedLotCost: s(house.plannedLotCost),
          plannedBuildCost: s(house.plannedBuildCost),
          plannedSalePrice: s(house.plannedSalePrice),
          plannedClosingCost: s(house.plannedClosingCost),
          bankName: house.bankName ?? "",
          bankLoanAmount: s(house.bankLoanAmount),
          bankOriginationFee: s(house.bankOriginationFee),
          bankInterestReserve: s(house.bankInterestReserve),
          bankCashToClose: s(house.bankCashToClose),
          bankBudgetReviewFee: s(house.bankBudgetReviewFee),
          bankCharges: s(house.bankCharges),
          actualLotCost: s(house.actualLotCost),
          actualBuildCost: s(house.actualBuildCost),
          ownCapital: s(house.ownCapital),
          soldPrice: s(house.soldPrice),
          payoffAmount: s(house.payoffAmount),
          netReceived: s(house.netReceived),
          closingCost: s(house.closingCost),
          contractDate: d(house.contractDate),
          saleDate: d(house.saleDate),
          notes: house.notes ?? "",
        }}
      />
    </div>
  );
}
