import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { houseEconomics } from "@/lib/pools/math";
import { PoolHouseForm } from "@/components/pool-house-form";

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
    include: { pool: true },
  });
  if (!house || house.poolId !== id) notFound();

  const eco = houseEconomics(house);
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
            <>cash at closing {formatMoney(eco.cashAtClosing, cur)} · </>
          )}
          {eco.result != null && <>result {formatMoney(eco.result, cur)}</>}
        </p>
      </div>
      <PoolHouseForm
        values={{
          id: house.id,
          poolId: house.poolId,
          address: house.address,
          status: house.status,
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
          closingCost: s(house.closingCost),
          contractDate: d(house.contractDate),
          saleDate: d(house.saleDate),
          notes: house.notes ?? "",
        }}
      />
    </div>
  );
}
