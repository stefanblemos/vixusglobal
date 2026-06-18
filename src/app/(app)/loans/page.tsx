import Link from "next/link";
import { prisma } from "@/lib/db";
import { computeLoanBalance } from "@/lib/loans/interest";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function LoansPage() {
  const loans = await prisma.intercompanyLoan.findMany({
    include: { lender: true, borrower: true, transactions: true },
  });
  const now = new Date();

  // Agrupa por EMPRESA QUE EMPRESTA, somando o que ela tem a receber.
  type Group = {
    lenderId: string;
    lenderName: string;
    currency: string;
    count: number;
    principal: number;
    interest: number;
  };
  const byLender = new Map<string, Group>();
  for (const loan of loans) {
    const bal = computeLoanBalance(
      {
        annualInterestRate: loan.annualInterestRate.toString(),
        dayCountBasis: loan.dayCountBasis,
        startDate: loan.startDate,
      },
      loan.transactions.map((t) => ({ type: t.type, amount: t.amount.toString(), date: t.date })),
      now,
    );
    const g = byLender.get(loan.lenderCompanyId) ?? {
      lenderId: loan.lenderCompanyId,
      lenderName: loan.lender.legalName,
      currency: loan.currency,
      count: 0,
      principal: 0,
      interest: 0,
    };
    g.count += 1;
    g.principal += Number(bal.principalOutstanding);
    g.interest += Number(bal.interestAccrued);
    byLender.set(loan.lenderCompanyId, g);
  }
  const groups = [...byLender.values()].sort((a, b) => b.principal - a.principal);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Loans</h1>
          <p className="text-sm text-slate-500">
            {loans.length} intercompany loan(s) across {groups.length} lender(s). Open a lender to
            see who it lent to.
          </p>
        </div>
        <Link
          href="/loans/new"
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
        >
          + New loan
        </Link>
      </div>

      {groups.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          No loans yet. Click <span className="font-medium">+ New loan</span> to add one, then import
          its QBO register.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {groups.map((g) => (
            <Link
              key={g.lenderId}
              href={`/loans/lender/${g.lenderId}`}
              className="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-[#1f3a5f]/40 hover:shadow-sm"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  Lender
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                  {g.count} {g.count === 1 ? "loan" : "loans"}
                </span>
              </div>
              <div className="mt-1 text-lg font-semibold text-slate-800">{g.lenderName}</div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-400">Receivable (principal)</div>
                  <div className="text-lg font-semibold tabular-nums text-slate-900">
                    {formatMoney(g.principal, g.currency)}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Interest accrued</div>
                  <div className="text-lg font-semibold tabular-nums text-slate-600">
                    {formatMoney(g.interest, g.currency)}
                  </div>
                </div>
              </div>
              <div className="mt-4 text-sm font-medium text-[#1f3a5f]">View borrowers →</div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
