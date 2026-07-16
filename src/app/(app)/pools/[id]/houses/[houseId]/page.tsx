import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney, sum } from "@/lib/money";
import { PoolHouseFicha } from "@/components/pool-house-ficha";
import { AddChangeOrderForm } from "@/components/pool-capital-forms";
import { deleteChangeOrder, deleteHouse } from "@/lib/actions/pools";

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
      pool: { include: { loans: { orderBy: { createdAt: "asc" }, include: { bankProfile: true } } } },
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
  const cur = house.pool.currency;

  return (
    <div className="max-w-4xl">
      <PoolHouseFicha
        crumb={`${house.pool.code}${house.pool.alias ? ` · ${house.pool.alias}` : ""} · Casas`}
        loanHref={`/pools/${id}/loan`}
        drawsTotal={Number(drawsTotal)}
        coTotal={Number(coTotal)}
        coCount={house.changeOrders.length}
        loans={house.pool.loans.map((l) => ({
          id: l.id,
          label: `${l.bankProfile?.name ?? "Banco a definir"}${l.loanNumber ? ` · ${l.loanNumber}` : ""}`,
        }))}
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
          loanId: house.loanId ?? "",
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
          lotContractDate: d(house.lotContractDate),
          lotPaidDate: d(house.lotPaidDate),
          buildStartDate: d(house.buildStartDate),
          coDate: d(house.coDate),
          notes: house.notes ?? "",
        }}
        changeOrders={
          <section className="mt-4 rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
              Change orders{" "}
              {house.changeOrders.length > 0 && (
                <span className="normal-case tracking-normal text-slate-400">
                  ({house.changeOrders.length} · {formatMoney(coTotal, cur)})
                </span>
              )}
            </h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Alteram o valor do contrato da obra; o total entra no lucro real da tabela. Se o
              total do pool passar do captado, gere a chamada de capital na aba Investidores.
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
        }
        dangerZone={
          <details className="mt-4 px-1 pb-8">
          <summary className="cursor-pointer text-xs text-slate-400 hover:text-red-600">
            Apagar esta casa…
          </summary>
          <div className="mt-2 flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-3">
            <p className="flex-1 text-xs text-red-800">
              Remove a casa e o realizado dela deste pool (change orders e vínculos de draws
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
