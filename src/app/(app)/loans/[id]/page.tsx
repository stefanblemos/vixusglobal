import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { computeLoanBalance } from "@/lib/loans/interest";
import { buildAnnualClosings } from "@/lib/loans/closings";
import { formatMoney } from "@/lib/money";
import { matchCompany } from "@/lib/qbo/match";
import { LoanTermsForm } from "@/components/loan-terms-form";
import { AddTransactionForm } from "@/components/add-transaction-form";
import { RegisterUpload } from "@/components/register-upload";
import { TxnYearSelect } from "@/components/txn-year-select";
import { deleteLoanTransaction, saveLoanYear, deleteLoanYear } from "@/lib/actions/loans";

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

export default async function LoanDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; txnYear?: string }>;
}) {
  const { id } = await params;
  const { tab, txnYear } = await searchParams;
  const activeTab = tab === "transactions" || tab === "terms" ? tab : "closings";
  const loan = await prisma.intercompanyLoan.findUnique({
    where: { id },
    include: {
      lender: true,
      borrower: true,
      transactions: { orderBy: { date: "asc" } },
      years: { orderBy: { year: "asc" } },
    },
  });
  if (!loan) notFound();

  const now = new Date();

  // Fechamento ANO A ANO: principal vem do register (transações); o app calcula juro (diário,
  // pelo termo do ano) + origination fee por aporte, e capitaliza o não pago em conta separada.
  const rateByYear = new Map(
    loan.years.filter((y) => y.annualRatePct != null).map((y) => [y.year, Number(y.annualRatePct)]),
  );
  const interestPaidByYear = new Map(loan.years.map((y) => [y.year, Number(y.interestPaid)]));
  const closings = buildAnnualClosings({
    startDate: loan.startDate,
    asOf: now,
    defaultRatePct: Number(loan.annualInterestRate) * 100,
    rateByYear,
    feeRate: Number(loan.originationFeeRate),
    interestPaidByYear,
    dayCountBasis: loan.dayCountBasis,
    txns: loan.transactions.map((t) => ({ type: t.type, amount: Number(t.amount), date: t.date })),
  });
  const last = closings.at(-1) ?? null;
  const currentYear = now.getUTCFullYear();
  const currentRatePct = rateByYear.get(currentYear) ?? Number(loan.annualInterestRate) * 100;
  const yearIdByYear = new Map(loan.years.map((y) => [y.year, y.id]));
  const nextYear = (loan.years.at(-1)?.year ?? loan.startDate.getUTCFullYear() - 1) + 1;

  // Saldo corrente do ledger de transações (igual ao register do QBO: desembolso +, amortização −).
  // Saldo corrente calculado em ordem CRONOLÓGICA (mais antigo → mais novo), independente do
  // filtro/visualização — o saldo é acumulado.
  let runBal = 0;
  const txnRows = loan.transactions.map((t) => {
    const signed = t.type === "REPAYMENT_PRINCIPAL" ? -Number(t.amount) : Number(t.amount);
    runBal += signed;
    return { t, signed, running: runBal };
  });
  // Anos disponíveis (desc) + filtro por ano (ou "all"). Exibição do mais NOVO para o mais
  // antigo, sempre vendo o último lançamento no topo.
  const txnYears = [...new Set(txnRows.map((r) => r.t.date.getUTCFullYear()))].sort((a, b) => b - a);
  const selectedTxnYear = txnYear && /^\d{4}$/.test(txnYear) ? Number(txnYear) : null;
  const txnRowsView = txnRows
    .filter((r) => selectedTxnYear == null || r.t.date.getUTCFullYear() === selectedTxnYear)
    .reverse();

  const bal = computeLoanBalance(
    {
      annualInterestRate: loan.annualInterestRate.toString(),
      dayCountBasis: loan.dayCountBasis,
      startDate: loan.startDate,
    },
    loan.transactions.map((t) => ({ type: t.type, amount: t.amount.toString(), date: t.date })),
    now,
  );

  // Conferência de 3 pontas: principal do ledger × BS do CREDOR (a receber) × BS do
  // DEVEDOR (a pagar). Os três têm que ser iguais; se a L2 e a Truss divergem, falta
  // lançamento numa ponta.
  const computedPrincipal = Number(bal.principalOutstanding.toString());
  const coCands = (c: {
    id: string;
    legalName: string;
    tradeName: string | null;
    aliases: string[];
  }) => [{ id: c.id, legalName: c.legalName, tradeName: c.tradeName, aliases: c.aliases }];

  // Acha a linha do empréstimo num Balance Sheet (conta nomeada pela contraparte, numa
  // seção de empréstimo/nota/payable; com fallback para qualquer linha que case o nome).
  const findLoanBalance = async (
    companyId: string,
    counterpartyId: string,
    counterparty: { id: string; legalName: string; tradeName: string | null; aliases: string[] },
    sectionRe: RegExp,
  ): Promise<{ value: number; period: string } | null> => {
    const bs = await prisma.qboImport.findFirst({
      where: { companyId, reportKind: "BALANCE_SHEET" },
      orderBy: { createdAt: "desc" },
      include: { lines: true },
    });
    if (!bs) return null;
    const cands = coCands(counterparty);
    const named = bs.lines.filter(
      (l) => l.lineType === "ACCOUNT" && l.value != null && matchCompany(l.label, cands) === counterpartyId,
    );
    const line = named.find((l) => l.sectionPath.some((s) => sectionRe.test(s))) ?? named[0];
    return line?.value != null
      ? { value: Math.abs(Number(line.value.toString())), period: bs.periodLabel }
      : null;
  };

  const lenderSide = await findLoanBalance(
    loan.lenderCompanyId,
    loan.borrowerCompanyId,
    loan.borrower,
    /loan|note|receiv|due\s*from|advance/i,
  );
  const borrowerSide = await findLoanBalance(
    loan.borrowerCompanyId,
    loan.lenderCompanyId,
    loan.lender,
    /loan|note|payable|due\s*to|from\s+others/i,
  );
  const tol = 0.01;
  const lenderMatch = lenderSide != null && Math.abs(lenderSide.value - computedPrincipal) < tol;
  const borrowerMatch = borrowerSide != null && Math.abs(borrowerSide.value - computedPrincipal) < tol;
  const sidesMismatch =
    lenderSide != null && borrowerSide != null && Math.abs(lenderSide.value - borrowerSide.value) >= tol;
  const periodsDiffer =
    lenderSide != null && borrowerSide != null && lenderSide.period !== borrowerSide.period;

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
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="rounded-full bg-[#1f3a5f]/10 px-2 py-0.5 font-medium text-[#1f3a5f]">
            Term in effect ({currentYear}): {currentRatePct}% · simple · {loan.currency}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
            Origination fee {Number(loan.originationFeeRate) * 100}%
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">
            {loan.dayCountBasis.replace("_", "/")}
          </span>
          <span
            className={`rounded-full px-2 py-0.5 ${loan.status === "ACTIVE" ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500"}`}
          >
            {loan.status}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Card
          label="Principal outstanding"
          value={formatMoney(last?.closingPrincipal ?? 0, loan.currency)}
        />
        <Card
          label="Capitalized interest (separate)"
          value={formatMoney(last?.closingCapitalized ?? 0, loan.currency)}
        />
        <Card
          label={`Interest accrued (${currentYear})`}
          value={formatMoney(last?.interestAccrued ?? 0, loan.currency)}
        />
        <Card
          label="Total owed"
          value={formatMoney(last?.totalOutstanding ?? 0, loan.currency)}
        />
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {[
          { key: "closings", label: "Annual closings" },
          { key: "transactions", label: "Transactions" },
          { key: "terms", label: "Terms" },
        ].map((t) => (
          <Link
            key={t.key}
            href={`/loans/${loan.id}?tab=${t.key}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm ${
              activeTab === t.key
                ? "border-[#1f3a5f] font-medium text-[#1f3a5f]"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {activeTab === "transactions" && (
      <section className="space-y-2">
        <h2 className="text-lg font-medium text-slate-800">QBO reconciliation — both sides</h2>
        <p className="text-sm text-slate-500">
          The loan balance should match on both QBOs: the lender&apos;s receivable and the
          borrower&apos;s payable. If they diverge, a movement is missing on one side.
        </p>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              <tr>
                <td className="px-4 py-3 text-slate-700">This loan (ledger)</td>
                <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                  {formatMoney(computedPrincipal, loan.currency)}
                </td>
                <td className="px-4 py-3 text-right text-xs text-slate-400">register</td>
                <td className="px-4 py-3" />
              </tr>
              <tr>
                <td className="px-4 py-3 text-slate-700">
                  {loan.lender.legalName} <span className="text-slate-400">— receivable</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-800">
                  {lenderSide ? formatMoney(lenderSide.value, loan.currency) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-xs text-slate-400">
                  {lenderSide?.period ?? "no BS"}
                </td>
                <td className="px-4 py-3 text-right">
                  <ReconPill ok={lenderMatch} has={lenderSide != null} />
                </td>
              </tr>
              <tr>
                <td className="px-4 py-3 text-slate-700">
                  {loan.borrower.legalName} <span className="text-slate-400">— payable</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-800">
                  {borrowerSide ? formatMoney(borrowerSide.value, loan.currency) : "—"}
                </td>
                <td className="px-4 py-3 text-right text-xs text-slate-400">
                  {borrowerSide?.period ?? "no BS"}
                </td>
                <td className="px-4 py-3 text-right">
                  <ReconPill ok={borrowerMatch} has={borrowerSide != null} />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {(() => {
          if (!lenderSide && !borrowerSide)
            return (
              <p className="text-xs text-slate-500">
                Import each side&apos;s QBO Balance Sheet (lender and borrower) to reconcile.
              </p>
            );
          if (sidesMismatch) {
            const diff = Math.abs(lenderSide!.value - borrowerSide!.value);
            const lower = lenderSide!.value < borrowerSide!.value ? loan.lender : loan.borrower;
            return (
              <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                ⚠ The two sides differ by {formatMoney(diff, loan.currency)} — looks like a movement
                is missing on <strong>{lower.legalName}</strong>&apos;s books.
              </p>
            );
          }
          if (lenderMatch && borrowerMatch)
            return (
              <p className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">
                ✓ Reconciled on both sides.
              </p>
            );
          const missing = !lenderSide ? loan.lender : !borrowerSide ? loan.borrower : null;
          return (
            <p className="text-sm text-amber-700">
              {missing
                ? `Import ${missing.legalName}'s QBO Balance Sheet to reconcile that side.`
                : "A side doesn't match the ledger — check that side's QBO."}
            </p>
          );
        })()}
        {periodsDiffer && (
          <p className="text-xs text-slate-400">
            Note: comparing different periods ({lenderSide?.period} vs {borrowerSide?.period}) — a
            difference may just be timing.
          </p>
        )}
      </section>
      )}

      {activeTab === "closings" && (
      <section className="space-y-2">
        <h2 className="text-lg font-medium text-slate-800">Annual closings</h2>
        <p className="text-sm text-slate-500">
          One closing per year. Principal comes from the register; the app computes the{" "}
          <strong>interest</strong> (daily, at the year&apos;s term rate) and the{" "}
          <strong>origination fee</strong> on each amount disbursed. What isn&apos;t paid by Dec 31 —
          the <strong>added (unpaid)</strong> amount — rolls into a{" "}
          <strong>separate capitalized</strong> bucket the next year, kept apart from principal.
          Enter the year&apos;s rate and how much interest was paid below.
        </p>
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Year</th>
                <th className="px-3 py-2 text-right font-medium">Rate</th>
                <th className="px-3 py-2 text-right font-medium">Principal (close)</th>
                <th className="px-3 py-2 text-right font-medium">Interest accrued</th>
                <th className="px-3 py-2 text-right font-medium">Orig. fee</th>
                <th className="px-3 py-2 text-right font-medium">Interest paid</th>
                <th className="px-3 py-2 text-right font-medium">Added (unpaid)</th>
                <th className="px-3 py-2 text-right font-medium">Capitalized (sep.)</th>
                <th className="px-3 py-2 text-right font-medium">Total owed</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {closings.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-3 py-4 text-sm text-slate-400">
                    Import the register and set the term to see the closings.
                  </td>
                </tr>
              ) : (
                closings.map((r) => (
                  <tr key={r.year} className={r.year === currentYear ? "bg-[#1f3a5f]/5" : ""}>
                    <td className="px-3 py-2 font-medium text-slate-700">
                      {r.year}
                      {r.year === currentYear && (
                        <span className="ml-1 text-xs text-slate-400">(current)</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {Number(r.ratePct)}%
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatMoney(r.closingPrincipal, loan.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatMoney(r.interestAccrued, loan.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                      {formatMoney(r.originationFees, loan.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-emerald-700">
                      {formatMoney(r.interestPaid, loan.currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-amber-700">
                      {formatMoney(r.unpaid, loan.currency)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-indigo-700">
                      {formatMoney(r.closingCapitalized, loan.currency)}
                    </td>
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">
                      {formatMoney(r.totalOutstanding, loan.currency)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {yearIdByYear.has(r.year) && (
                        <form action={deleteLoanYear}>
                          <input type="hidden" name="yearId" value={yearIdByYear.get(r.year) ?? ""} />
                          <input type="hidden" name="loanId" value={loan.id} />
                          <button className="text-xs text-slate-400 hover:text-red-600">reset</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <form
          action={saveLoanYear}
          className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
        >
          <input type="hidden" name="loanId" value={loan.id} />
          <YearInput name="year" label="Year" defaultValue={String(nextYear)} width="w-20" />
          <YearInput name="annualRatePct" label="Rate % (term)" placeholder="6.5" width="w-24" />
          <YearInput name="interestPaid" label="Interest paid this year" placeholder="0" />
          <button className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]">
            Save year
          </button>
          <span className="basis-full text-xs text-slate-400">
            Set the term rate for a year (defaults to the loan rate below) and the interest actually
            paid. Principal and disbursements come from the register.
          </span>
        </form>
      </section>
      )}

      {activeTab === "terms" && (
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
      )}

      {activeTab === "transactions" && (
      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-800">Transactions (ledger)</h2>
        {/* Entrada no topo: importar register + lançar manual */}
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <RegisterUpload loanId={loan.id} />
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <AddTransactionForm loanId={loan.id} />
        </div>

        {txnRows.length === 0 ? (
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <p className="p-6 text-sm text-slate-500">
              No transactions yet — import the QBO register above.
            </p>
          </div>
        ) : (
          <>
            {/* Filtro por ano (select) */}
            <TxnYearSelect loanId={loan.id} years={txnYears} selected={selectedTxnYear} />
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Type</th>
                    <th className="px-4 py-3 font-medium">Memo</th>
                    <th className="px-4 py-3 text-right font-medium">Amount</th>
                    <th className="px-4 py-3 text-right font-medium">Balance</th>
                    <th className="px-4 py-3"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {txnRowsView.map(({ t, signed, running }) => (
                    <tr key={t.id}>
                      <td className="px-4 py-3 whitespace-nowrap text-slate-600">
                        {isoDate(t.date)}
                      </td>
                      <td className="px-4 py-3 text-slate-700">{TXN_LABEL[t.type]}</td>
                      <td className="px-4 py-3 text-slate-500">{t.memo ?? "—"}</td>
                      <td
                        className={`px-4 py-3 text-right tabular-nums ${signed < 0 ? "text-rose-600" : "text-slate-800"}`}
                      >
                        {signed < 0 ? `(${formatMoney(-signed, loan.currency)})` : formatMoney(signed, loan.currency)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-900">
                        {formatMoney(running, loan.currency)}
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
            </div>
          </>
        )}
      </section>
      )}
    </div>
  );
}

function YearInput({
  name,
  label,
  defaultValue,
  placeholder,
  width = "w-32",
}: {
  name: string;
  label: string;
  defaultValue?: string;
  placeholder?: string;
  width?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-slate-500">{label}</span>
      <input
        name={name}
        defaultValue={defaultValue}
        placeholder={placeholder}
        autoComplete="off"
        className={`${width} rounded-lg border border-slate-300 px-2 py-1.5 text-sm tabular-nums outline-none focus:border-[#1f3a5f] focus:ring-1 focus:ring-[#1f3a5f]`}
      />
    </label>
  );
}

function ReconPill({ ok, has }: { ok: boolean; has: boolean }) {
  if (!has)
    return (
      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-400">no BS</span>
    );
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs ${ok ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}
    >
      {ok ? "matches ✓" : "differs"}
    </span>
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
