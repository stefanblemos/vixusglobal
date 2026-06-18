import Link from "next/link";
import { prisma } from "@/lib/db";
import { LoanCreateForm } from "@/components/loan-create-form";

export default async function NewLoanPage() {
  const companies = await prisma.company.findMany({
    orderBy: { legalName: "asc" },
    select: { id: true, legalName: true },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/loans" className="text-sm text-slate-500 hover:text-slate-700">
          ← Loans
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">New intercompany loan</h1>
        <p className="text-sm text-slate-500">Who lent and who received, plus the term.</p>
      </div>
      <LoanCreateForm companies={companies} />
    </div>
  );
}
