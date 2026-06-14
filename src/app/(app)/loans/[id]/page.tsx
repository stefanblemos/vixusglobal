import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { computeLoanBalance } from "@/lib/loans/interest";
import { formatMoney } from "@/lib/money";
import { matchCompany } from "@/lib/qbo/match";
import { LoanTermsForm } from "@/components/loan-terms-form";
import { AddTransactionForm } from "@/components/add-transaction-form";
import { deleteLoanTransaction } from "@/lib/actions/loans";

const TXN_LABEL: Record<string, string> = {
  DISBURSEMENT: "Disbursement",
  REPAYMENT_PRINCIPAL: "Principal repayment",
  REPAYMENT_INTEREST: "Interest repayment",
  ORIGINATION_FEE: "Origination fee",
  INTEREST_ACCRUAL: "Interest accrual",
  ADJUSTMENT: "Adjustment",
};

const pct = (v: { toString(): string }) => `${Number(v.toString()) * 100}`;
const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

export default async function LoanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const loan = await prisma.intercompanyLoan.findUnique({
    where: { id },
    include: { lender: true, borrower: true, transactions: { orderBy: { date: "asc" } } },
  });
  if (!loan) notFound();

  const now = new Date();
  const bal = computeLoanBalance(
    {
      annualInterestRate: loan.annualInterestRate.toString(),
      dayCountBasis: loan.dayCountBasis,
      startDate: loan.startDate,
    },
    loan.transactions.map((t) => ({ type: t.type, amount: t.amount.toString(), date: t.date })),
    now,
  );

  // Reconciliação com o QBO: saldo da última BS do credor para este devedor.
  const lenderBs = await prisma.qboImport.findFirst({
    where: { companyId: loan.lenderCompanyId, reportKind: "BALANCE_SHEET" },
    orderBy: { createdAt: "desc" },
    include: { lines: true },
  });
  let qboBalance: number | null = null;
  let qboPeriod: string | null = null;
  if (lenderBs) {
    const cands = [
      {
        id: loan.borrowerCompanyId,
        legalName: loan.borrower.legalName,
        tradeName: loan.borrower.tradeName,
        aliases: loan.borrower.aliases,
      },
    ];
    const line = lenderBs.lines.find(
      (l) =>
        l.lineType === "ACCOUNT" &&
        l.sectionPath.some((s) => /loans?\s+to\s+others/i.test(s)) &&
        matchCompany(l.label, cands) === loan.borrowerCompanyId,
    );
    if (line?.value != null) {
      qboBalance = Number(line.value.toString());
      qboPeriod = lenderBs.periodLabel;
    }
  }
  const computedPrincipal = Number(bal.principalOutstanding.toString());
  const reconciled = qboBalance != null && Math.abs(qboBalance - computedPrincipal) < 0.01;

  return (
    <div className="space-y-8">
      <div>
        <Link href="/loans" className="text-sm text-slate-500 hover:text-slate-700">
          ← Loans
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">
          {loan.lender.legalName} <span className="text-slate-400">→</span>{" "}
          {loan.borrower.legalName}
        </h1>
        <p className="text-sm text-slate-500">
          Principal {formatMoney(loan.principal, loan.currency)}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card
          label="Principal outstanding"
          value={formatMoney(bal.principalOutstanding, loan.currency)}
        />
        <Card label="Interest accrued" value={formatMoney(bal.interestAccrued, loan.currency)} />
        <Card label="Interest paid" value={formatMoney(bal.interestPaid, loan.currency)} />
        <Card label="Total outstanding" value={formatMoney(bal.totalOutstanding, loan.currency)} />
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-slate-800">QBO reconciliation</h2>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          {qboBalance == null ? (
            <p className="text-sm text-slate-500">
              No QBO balance found — import the lender&apos;s Balance Sheet to reconcile.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-6 text-sm">
              <div>
                <div className="text-xs text-slate-400">Computed (from transactions)</div>
                <div className="tabular-nums text-slate-800">
                  {formatMoney(computedPrincipal, loan.currency)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">QBO balance ({qboPeriod})</div>
                <div className="tabular-nums text-slate-800">
                  {formatMoney(qboBalance, loan.currency)}
                </div>
              </div>
              <span
                className={`rounded-full px-3 py-1 text-xs ${
                  reconciled ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"
                }`}
              >
                {reconciled ? "Reconciled" : "Mismatch"}
              </span>
              {!reconciled && loan.transactions.length === 0 && (
                <span className="text-xs text-slate-500">
                  Add the dated disbursement(s) below so interest can be computed.
                </span>
              )}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-800">Terms</h2>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <LoanTermsForm
            loanId={loan.id}
            d={{
              annualInterestRatePct: pct(loan.annualInterestRate),
              originationFeeRatePct: pct(loan.originationFeeRate),
              dayCountBasis: loan.dayCountBasis,
              interestMethod: loan.interestMethod,
              startDate: isoDate(loan.startDate),
              maturityDate: isoDate(loan.maturityDate),
              status: loan.status,
            }}
          />
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-800">Transactions</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {loan.transactions.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No transactions yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Memo</th>
                  <th className="px-4 py-3 text-right font-medium">Amount</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loan.transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="px-4 py-3 text-slate-600">{isoDate(t.date)}</td>
                    <td className="px-4 py-3 text-slate-700">{TXN_LABEL[t.type]}</td>
                    <td className="px-4 py-3 text-slate-500">{t.memo ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums text-slate-800">
                      {formatMoney(t.amount, loan.currency)}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <form action={deleteLoanTransaction}>
                        <input type="hidden" name="txnId" value={t.id} />
                        <input type="hidden" name="loanId" value={loan.id} />
                        <button className="text-xs text-slate-400 hover:text-red-600">
                          Remove
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <AddTransactionForm loanId={loan.id} />
        </div>
      </section>
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
