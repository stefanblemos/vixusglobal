import Link from "next/link";
import { prisma } from "@/lib/db";
import { roman } from "@/lib/pools/math";
import { PoolForm } from "@/components/pool-form";

export const dynamic = "force-dynamic";

export default async function NewPoolPage() {
  const count = await prisma.investmentPool.count();
  const nextCode = `VHP-${roman(count + 1)}`;

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href="/pools" className="text-sm text-slate-500 hover:text-slate-700">
          ← Pools
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">New investment pool</h1>
        <p className="text-sm text-slate-500">
          One pool = one LLC with a frozen cap table. The suggested code follows the sequence.
        </p>
      </div>
      <PoolForm
        values={{
          code: nextCode,
          name: `Vixus Home Partners ${roman(count + 1)} LLC`,
          alias: "",
          unitPrice: "1000",
          targetAmount: "",
          profitSharePct: "",
          profitShareTiming: "",
          fundingDeadline: "",
          startDate: "",
          plannedEndDate: "",
          effectiveEndDate: "",
          notes: "",
        }}
      />
    </div>
  );
}
