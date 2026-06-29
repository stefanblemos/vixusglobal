import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { BankReview } from "@/components/bank-review";
import { GlAccountMapper } from "@/components/bank-gl-mapper";
import { resetLine } from "@/lib/actions/bank";
import { buildBankReconSummary } from "@/lib/bank/summary";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (v: number, ccy: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: ccy }).format(v);

const STATUS_BADGE: Record<string, { label: string; cls: string }> = {
  FLAGGED: { label: "Missing booking", cls: "bg-amber-50 text-amber-700" },
  IGNORED: { label: "Ignored", cls: "bg-slate-100 text-slate-500" },
};

export default async function BankStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const st = await prisma.bankStatement.findUnique({
    where: { id },
    include: { company: true, lines: { orderBy: { date: "asc" } } },
  });
  if (!st) notFound();
  const ccy = st.company?.baseCurrency ?? "USD";

  // Ignora linhas zeradas (ex.: fee waivers que se anulam) — não entram na reconciliação
  // nem no match rate. (Imports novos já não as trazem; isto limpa os antigos.)
  const lines = st.lines.filter((l) => Number(l.amount.toString()) !== 0);
  const matched = lines.filter((l) => l.status === "MATCHED").length;
  const toReview = lines.filter((l) => l.status === "UNREVIEWED");
  const reviewed = lines.filter((l) => l.status === "FLAGGED" || l.status === "IGNORED");
  const matchRate = lines.length ? Math.round((matched / lines.length) * 100) : 0;

  const summary = await buildBankReconSummary(prisma, id);
  const reconciles = summary != null && Math.abs(summary.difference) < 0.005;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/bank" className="text-sm text-slate-500 hover:text-slate-700">
          ← Bank
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">
          {st.company?.legalName ?? "—"}
        </h1>
        <p className="text-sm text-slate-500">
          {st.bankLabel} · {isoDate(st.periodStart ?? st.lines[0]?.date ?? new Date())} →{" "}
          {isoDate(st.periodEnd ?? new Date())} · ending{" "}
          {st.endingBalance != null ? formatMoney(st.endingBalance, ccy) : "—"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Matched" value={`${matched}`} cls="text-green-700" />
        <Stat label="To review" value={`${toReview.length}`} cls="text-amber-700" />
        <Stat label="Flagged / ignored" value={`${reviewed.length}`} cls="text-slate-700" />
        <Stat label="Match rate" value={`${matchRate}%`} cls="text-slate-800" />
      </div>

      {summary?.hasGl ? (
        <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <div>
            <h2 className="text-lg font-medium text-slate-800">Reconcile against the GL</h2>
            <p className="text-sm text-slate-500">
              Map this statement to its cash account in the General Ledger. Matching is then
              restricted to that account — never A/R, inventory or A/P (GL ≠ statement).
            </p>
          </div>

          <GlAccountMapper
            statementId={id}
            accounts={summary.glAccounts}
            current={summary.mappedAccount}
          />

          {summary.mappedAccount ? (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              <Stat label="Statement net" value={fmt(summary.bankNet, ccy)} cls="text-slate-800" />
              <Stat label="GL cash net (period)" value={fmt(summary.glNet, ccy)} cls="text-slate-800" />
              <div
                className={`rounded-xl border p-4 ${
                  reconciles ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"
                }`}
              >
                <div className="text-xs text-slate-500">Difference</div>
                <div
                  className={`mt-1 text-2xl font-semibold ${
                    reconciles ? "text-green-700" : "text-amber-700"
                  }`}
                >
                  {fmt(summary.difference, ccy)}
                </div>
                <div className={`text-xs ${reconciles ? "text-green-700" : "text-amber-700"}`}>
                  {reconciles ? "Period reconciles ✓" : "Out of balance — see exceptions"}
                </div>
              </div>
            </div>
          ) : (
            <p className="rounded-lg bg-amber-50 px-4 py-2 text-sm text-amber-700">
              Not mapped yet — auto-match is currently comparing against the whole GL, which can
              produce false matches. Pick the cash account above and re-match.
            </p>
          )}
        </section>
      ) : (
        <p className="rounded-lg bg-slate-50 px-4 py-3 text-sm text-slate-500">
          No General Ledger imported for this company yet — import the GL in Documents to enable
          account-scoped reconciliation and the books-vs-bank check.
        </p>
      )}

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-slate-800">To review ({toReview.length})</h2>
        <p className="text-sm text-slate-500">
          Bank lines with no automatic match. Open each to match it to a ledger entry, flag a
          missing booking, or ignore it.
        </p>
        {toReview.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-green-700">
            Nothing left to review. ✓
          </div>
        ) : (
          <BankReview
            lines={toReview.map((l) => ({
              id: l.id,
              date: isoDate(l.date),
              description: l.description,
              amount: l.amount.toString(),
            }))}
          />
        )}
      </section>

      {summary?.mappedAccount && summary.bookedNotOnStatement.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium text-slate-800">
            In the books, not on the statement ({summary.bookedNotOnStatement.length})
          </h2>
          <p className="text-sm text-slate-500">
            Cash-account entries booked in the GL with no matching bank line in this period —
            usually timing (uncleared), an internal transfer, or a booking that never hit the bank.
          </p>

          {/* Agrupado pela conta de contrapartida (split): líquido ≈ 0 = entrou e saiu (benigno);
              líquido ≠ 0 = o resíduo real a investigar. */}
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
              By contra-account — <span className="text-emerald-600">net ≈ 0</span> means it went in
              and out (benign); a <span className="text-amber-700">non-zero net</span> is the real
              residual to investigate.
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Contra-account (split)</th>
                  <th className="px-3 py-2 text-right font-medium">Entries</th>
                  <th className="px-3 py-2 text-right font-medium">In</th>
                  <th className="px-3 py-2 text-right font-medium">Out</th>
                  <th className="px-3 py-2 text-right font-medium">Net</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summary.reverseByAccount.map((g) => {
                  const benign = Math.abs(g.net) < 0.005;
                  return (
                    <tr key={g.account} className={benign ? "" : "bg-amber-50/40"}>
                      <td className="px-3 py-1.5 text-slate-700">{g.account}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{g.count}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                        {g.inflow ? formatMoney(g.inflow, ccy) : "—"}
                      </td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">
                        {g.outflow ? formatMoney(g.outflow, ccy) : "—"}
                      </td>
                      <td
                        className={`px-3 py-1.5 text-right tabular-nums font-medium ${
                          benign ? "text-emerald-600" : "text-amber-700"
                        }`}
                      >
                        {formatMoney(g.net, ccy)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Lista detalhada completa (não trunca) — recolhida por padrão. */}
          <details className="rounded-xl border border-slate-200 bg-white">
            <summary className="cursor-pointer px-3 py-2 text-sm text-slate-600">
              Show all {summary.bookedNotOnStatement.length} entries
            </summary>
            <div className="overflow-hidden border-t border-slate-100">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium">Name</th>
                    <th className="px-3 py-2 font-medium">Split</th>
                    <th className="px-3 py-2 text-right font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {summary.bookedNotOnStatement.map((t) => (
                    <tr key={t.id}>
                      <td className="px-3 py-1.5 whitespace-nowrap text-slate-600">{t.date}</td>
                      <td className="px-3 py-1.5 text-slate-600">{t.type}</td>
                      <td className="px-3 py-1.5 text-slate-700">{t.name ?? "—"}</td>
                      <td className="px-3 py-1.5 text-slate-500">{t.split ?? "—"}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                        {formatMoney(t.amount, ccy)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      {reviewed.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium text-slate-800">Reviewed exceptions</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Note</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {reviewed.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-600">
                      {isoDate(l.date)}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700">{l.description}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                      {formatMoney(l.amount, ccy)}
                    </td>
                    <td className="px-3 py-1.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[l.status]?.cls ?? ""}`}
                      >
                        {STATUS_BADGE[l.status]?.label ?? l.status}
                      </span>
                    </td>
                    <td className="px-3 py-1.5 text-slate-500">{l.note ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right">
                      <form action={resetLine.bind(null, l.id)}>
                        <button className="text-xs text-slate-400 hover:text-slate-700">
                          Reopen
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
