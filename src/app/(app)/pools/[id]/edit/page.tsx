import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PoolForm } from "@/components/pool-form";

export const dynamic = "force-dynamic";

const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : "");

export default async function EditPoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await prisma.investmentPool.findUnique({ where: { id } });
  if (!pool) notFound();
  // entidade + nota participativa (17/07): os badges de pendência do Overview apontam p/ cá
  const [companies, noteLoans] = await Promise.all([
    prisma.company.findMany({ orderBy: { legalName: "asc" }, select: { id: true, legalName: true } }),
    prisma.intercompanyLoan.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, lender: { select: { legalName: true } }, borrower: { select: { legalName: true } } },
    }),
  ]);

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/pools/${pool.id}`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {pool.code}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Edit pool</h1>
      </div>
      <PoolForm
        values={{
          id: pool.id,
          code: pool.code,
          name: pool.name,
          alias: pool.alias ?? "",
          status: pool.status,
          unitPrice: pool.unitPrice.toString(),
          targetAmount: pool.targetAmount?.toString() ?? "",
          profitSharePct:
            pool.profitSharePct == null ? "" : (Number(pool.profitSharePct) * 100).toString(),
          profitShareTiming: pool.profitShareTiming ?? "",
          fundingDeadline: d(pool.fundingDeadline),
          startDate: d(pool.startDate),
          plannedEndDate: d(pool.plannedEndDate),
          effectiveEndDate: d(pool.effectiveEndDate),
          companyId: pool.companyId ?? "",
          noteLoanId: pool.noteLoanId ?? "",
          notes: pool.notes ?? "",
        }}
        companies={companies.map((c) => ({ id: c.id, name: c.legalName }))}
        noteLoans={noteLoans.map((n) => ({
          id: n.id,
          label: `${n.lender.legalName} → ${n.borrower.legalName}`,
        }))}
      />
    </div>
  );
}
