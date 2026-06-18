import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { computeLoanBalance } from "@/lib/loans/interest";
import { formatMoney } from "@/lib/money";

const STATUS_CLS: Record<string, string> = {
  ACTIVE: "bg-green-50 text-green-700",
  PAID: "bg-slate-100 text-slate-600",
  DEFAULTED: "bg-red-50 text-red-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

export default async function LenderLoansPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [lender, loans] = await Promise.all([
    prisma.company.findUnique({ where: { id }, select: { legalName: true } }),
    prisma.intercompanyLoan.findMany({
      where: { lenderCompanyId: id },
      include: { borrower: true, transactions: true },
      orderBy: { createdAt: "asc" },
    }),
  ]);
  if (!lender) notFound();

  const now = new Date();
  const rows = loans.map((loan) => {
    const bal = computeLoanBalance(
      {
        annualInterestRate: loan.annualInterestRate.toString(),
        dayCountBasis: loan.dayCountBasis,
        startDate: loan.startDate,
      },
      loan.transactions.map((t) => ({ type: t.type, amount: t.amount.toString(), date: t.date })),
      now,
    );
    return {
      loan,
      principal: Number(bal.principalOutstanding),
      interest: Number(bal.interestAccrued),
    };
  });
  const currency = loans[0]?.currency ?? "USD";
  const totalPrincipal = rows.reduce((s, r) => s + r.principal, 0);
  const totalInterest = rows.reduce((s, r) => s + r.interest, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/loans" className="text-sm text-slate-500 hover:text-slate-700">
          ← Loans
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">{lender.legalName}</h1>
        <p className="text-sm text-slate-500">
          Lent to {rows.length} {rows.length === 1 ? "borrower" : "borrowers"}.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card label="Borrowers" value={String(rows.length)} />
        <Card label="Receivable (principal)" value={formatMoney(totalPrincipal, currency)} />
        <Card label="Interest accrued" value={formatMoney(totalInterest, currency)} />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Borrower</th>
              <th className="px-4 py-3 text-right font-medium">Rate</th>
              <th className="px-4 py-3 text-right font-medium">Principal o/s</th>
              <th className="px-4 py-3 text-right font-medium">Interest accrued</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map(({ loan, principal, interest }) => (
              <tr key={loan.id} className="hover:bg-slate-50">
                <td className="px-4 py-3">
                  <Link
                    href={`/loans/${loan.id}`}
                    className="font-medium text-[#1f3a5f] hover:underline"
                  >
                    {loan.borrower.legalName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                  {Number(loan.annualInterestRate) * 100}%
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-800">
                  {formatMoney(principal, loan.currency)}
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                  {formatMoney(interest, loan.currency)}
                </td>
                <td className="px-4 py-3">
                  <span className={`rounded-full px-3 py-1 text-xs ${STATUS_CLS[loan.status] ?? ""}`}>
                    {loan.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-slate-800">{value}</div>
    </div>
  );
}
