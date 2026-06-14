import Link from "next/link";
import { prisma } from "@/lib/db";
import { computeLoanBalance } from "@/lib/loans/interest";
import { formatMoney } from "@/lib/money";

const STATUS_CLS: Record<string, string> = {
  ACTIVE: "bg-green-50 text-green-700",
  PAID: "bg-slate-100 text-slate-600",
  DEFAULTED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

export default async function LoansPage() {
  const loans = await prisma.intercompanyLoan.findMany({
    orderBy: { createdAt: "desc" },
    include: { lender: true, borrower: true, transactions: true },
  });

  const now = new Date();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Loans</h1>
        <p className="text-sm text-slate-500">
          {loans.length} intercompany loan(s). Outstanding is computed from dated transactions.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {loans.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No loans yet. Create them from a QBO import (Detected relationships).
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Lender</th>
                <th className="px-4 py-3 font-medium">Borrower</th>
                <th className="px-4 py-3 text-right font-medium">Principal o/s</th>
                <th className="px-4 py-3 text-right font-medium">Interest accrued</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loans.map((loan) => {
                const bal = computeLoanBalance(
                  {
                    annualInterestRate: loan.annualInterestRate.toString(),
                    dayCountBasis: loan.dayCountBasis,
                    startDate: loan.startDate,
                  },
                  loan.transactions.map((t) => ({
                    type: t.type,
                    amount: t.amount.toString(),
                    date: t.date,
                  })),
                  now,
                );
                return (
                  <tr key={loan.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/loans/${loan.id}`}
                        className="font-medium text-[#1f3a5f] hover:underline"
                      >
                        {loan.lender.legalName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-700">{loan.borrower.legalName}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-800">
                      {formatMoney(bal.principalOutstanding, loan.currency)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                      {formatMoney(bal.interestAccrued, loan.currency)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-3 py-1 text-xs ${STATUS_CLS[loan.status] ?? ""}`}
                      >
                        {loan.status}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
