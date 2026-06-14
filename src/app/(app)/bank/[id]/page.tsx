import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { BankReview } from "@/components/bank-review";
import { resetLine } from "@/lib/actions/bank";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

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

  const matched = st.lines.filter((l) => l.status === "MATCHED").length;
  const toReview = st.lines.filter((l) => l.status === "UNREVIEWED");
  const reviewed = st.lines.filter((l) => l.status === "FLAGGED" || l.status === "IGNORED");
  const matchRate = st.lines.length ? Math.round((matched / st.lines.length) * 100) : 0;

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
          {st.endingBalance != null ? formatMoney(st.endingBalance, "USD") : "—"}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Matched" value={`${matched}`} cls="text-green-700" />
        <Stat label="To review" value={`${toReview.length}`} cls="text-amber-700" />
        <Stat label="Flagged / ignored" value={`${reviewed.length}`} cls="text-slate-700" />
        <Stat label="Match rate" value={`${matchRate}%`} cls="text-slate-800" />
      </div>

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
                      {formatMoney(l.amount, "USD")}
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
