import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const DAY = 86_400_000;
const WINDOW_DAYS = 5;

export default async function BankStatementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const st = await prisma.bankStatement.findUnique({
    where: { id },
    include: { company: true, lines: { orderBy: { date: "asc" } } },
  });
  if (!st) notFound();

  // Razão (GL) da empresa para casar por valor + data.
  const gl = await prisma.ledgerTxn.findMany({
    where: { companyId: st.companyId },
    select: { id: true, date: true, amount: true },
  });
  const glByAmount = new Map<string, { id: string; date: Date }[]>();
  for (const t of gl) {
    const key = Number(t.amount.toString()).toFixed(2);
    (glByAmount.get(key) ?? glByAmount.set(key, []).get(key)!).push({ id: t.id, date: t.date });
  }

  const used = new Set<string>();
  let matched = 0;
  const unmatched: typeof st.lines = [];
  for (const line of st.lines) {
    const key = Number(line.amount.toString()).toFixed(2);
    const cands = glByAmount.get(key) ?? [];
    const hit = cands.find(
      (c) =>
        !used.has(c.id) && Math.abs(c.date.getTime() - line.date.getTime()) <= WINDOW_DAYS * DAY,
    );
    if (hit) {
      used.add(hit.id);
      matched++;
    } else {
      unmatched.push(line);
    }
  }

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

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Matched to ledger" value={`${matched}`} cls="text-green-700" />
        <Stat label="Unmatched (review)" value={`${unmatched.length}`} cls="text-amber-700" />
        <Stat label="Match rate" value={`${matchRate}%`} cls="text-slate-800" />
      </div>

      <section className="space-y-2">
        <h2 className="text-lg font-medium text-slate-800">
          Bank transactions not found in the ledger
        </h2>
        <p className="text-sm text-slate-500">
          These appear on the statement but have no matching entry (by amount within ±{WINDOW_DAYS}{" "}
          days). Review for missing bookings.
        </p>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {unmatched.length === 0 ? (
            <p className="p-6 text-sm text-green-700">Everything reconciles. ✓</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-3 py-2 font-medium">Date</th>
                  <th className="px-3 py-2 font-medium">Description</th>
                  <th className="px-3 py-2 text-right font-medium">Amount</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {unmatched.map((l) => (
                  <tr key={l.id}>
                    <td className="px-3 py-1.5 whitespace-nowrap text-slate-600">
                      {isoDate(l.date)}
                    </td>
                    <td className="px-3 py-1.5 text-slate-700">{l.description}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                      {formatMoney(l.amount, "USD")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
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
