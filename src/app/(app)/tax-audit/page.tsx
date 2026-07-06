import { resolveWanted } from "@/lib/year";
import Link from "next/link";
import { buildIrReconciliation, type ReconStatus, type RowSeverity } from "@/lib/tax/audit-vs-ir";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const m = (n: number | null) => (n == null ? "—" : formatMoney(n, "USD"));

const SEV: Record<RowSeverity, { label: string; cls: string }> = {
  diverge: { label: "diverges from return", cls: "bg-rose-100 text-rose-700" },
  warn: { label: "attention", cls: "bg-amber-100 text-amber-700" },
  "no-ir": { label: "no return to check", cls: "bg-slate-100 text-slate-500" },
  "no-qbo": { label: "no QBO for year", cls: "bg-slate-100 text-slate-500" },
  ok: { label: "matches", cls: "bg-[#8DC63F]/20 text-[#3B6D11]" },
};

const STATUS_DOT: Record<ReconStatus, string> = {
  match: "bg-[#8DC63F]",
  diverge: "bg-rose-500",
  expected: "bg-sky-400",
  "no-ir": "bg-slate-300",
};

export default async function TaxAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const wanted = await resolveWanted(yParam);

  const probe = await buildIrReconciliation(wanted ?? currentYear - 1);
  const years = probe.years.length ? probe.years : [currentYear - 1];
  const year = wanted ?? (years.includes(currentYear - 1) ? currentYear - 1 : years[0]);
  const data = wanted === year ? probe : await buildIrReconciliation(year);
  const s = data.summary;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Return check × QBO</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Compares what the app <strong>calculates</strong> (tax preview, from QBO) with what the
          accountant <strong>filed</strong> (the tax return figures). Divergence = investigate; &ldquo;expected&rdquo;
          (blue) = a holding whose return consolidates the K-1 while the standalone book does not. It is the Tax preview checked
          against the source of truth — nothing guessed.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Year:</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/tax-audit?year=${y}`}
            className={`rounded-full px-3 py-1 ${y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {y}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[
          { n: s.diverging, label: "diverge", cls: "border-rose-300 bg-rose-50 text-rose-700" },
          { n: s.warn, label: "attention", cls: "border-amber-300 bg-amber-50 text-amber-700" },
          { n: s.ok, label: "match", cls: "border-[#8DC63F]/50 bg-[#8DC63F]/10 text-[#3B6D11]" },
          { n: s.noIr, label: "no return", cls: "border-slate-200 bg-slate-50 text-slate-500" },
          { n: s.noQbo, label: "no QBO", cls: "border-slate-200 bg-slate-50 text-slate-500" },
        ].map((c) => (
          <div key={c.label} className={`rounded-xl border p-3 ${c.cls}`}>
            <div className="text-2xl font-semibold tabular-nums">{c.n}</div>
            <div className="text-xs">{c.label}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {data.rows.map((r) => {
          const sev = SEV[r.severity];
          const divergeCount = r.metrics.filter((mt) => mt.status === "diverge").length;
          return (
            <details key={r.companyId} className="group overflow-hidden rounded-xl border border-slate-200 bg-white" open={r.severity === "diverge"}>
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="text-slate-400 transition group-open:rotate-90">›</span>
                  <span className="truncate font-medium text-slate-800">{r.name}</span>
                  {r.acronym && <span className="shrink-0 text-[11px] text-slate-400">{r.acronym}</span>}
                  <span className="shrink-0 rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">{r.entityType}</span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {divergeCount > 0 && <span className="text-[11px] text-rose-600">{divergeCount} metric{divergeCount > 1 ? "s" : ""}</span>}
                  {r.flags.length > 0 && <span className="text-[11px] text-amber-600">⚠ {r.flags.length}</span>}
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${sev.cls}`}>{sev.label}</span>
                </div>
              </summary>

              <div className="border-t border-slate-100 px-4 py-3">
                {r.metrics.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                        <tr>
                          <th className="py-1 font-medium">Metric</th>
                          <th className="py-1 text-right font-medium">Preview (QBO)</th>
                          <th className="py-1 text-right font-medium">Return (accountant)</th>
                          <th className="py-1 text-right font-medium">Δ</th>
                          <th className="py-1 pl-3 font-medium">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-50">
                        {r.metrics.map((mt) => (
                          <tr key={mt.key}>
                            <td className="py-1.5 text-slate-700">{mt.label}</td>
                            <td className="py-1.5 text-right tabular-nums text-slate-600">{m(mt.preview)}</td>
                            <td className="py-1.5 text-right tabular-nums text-slate-600">{m(mt.ir)}</td>
                            <td className={`py-1.5 text-right tabular-nums ${mt.diff && Math.abs(mt.diff) > 0 ? (mt.status === "diverge" ? "text-rose-600" : "text-slate-400") : "text-slate-300"}`}>
                              {mt.diff == null ? "—" : (mt.diff > 0 ? "+" : "") + mt.diff.toLocaleString("en-US")}
                            </td>
                            <td className="py-1.5 pl-3">
                              <span className="inline-flex items-center gap-1.5 text-[11px] text-slate-500">
                                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[mt.status]}`} />
                                {mt.status === "match" ? "matches" : mt.status === "diverge" ? "diverges" : mt.status === "expected" ? "expected" : "no return"}
                              </span>
                              {mt.note && <div className="mt-0.5 text-[10px] text-sky-600">{mt.note}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No metrics to compare in this year.</p>
                )}

                {r.flags.length > 0 && (
                  <ul className="mt-3 space-y-1">
                    {r.flags.map((f, i) => (
                      <li key={i} className="rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">⚠ {f}</li>
                    ))}
                  </ul>
                )}

                <div className="mt-3 flex gap-3 text-[11px]">
                  <Link href={`/tax-preview?year=${year}`} className="text-sky-700 hover:underline">view in Tax preview →</Link>
                  <Link href={`/companies/${r.companyId}/year/${year}`} className="text-sky-700 hover:underline">open the company ({year}) →</Link>
                </div>
              </div>
            </details>
          );
        })}
      </div>

      <p className="text-[11px] text-slate-400">
        Tolerance: diverges if |preview − return| &gt; max($1,000, 8% of the return) — small book→tax adjustments do not
        count. Taxable income, add-backs (M-1) and depreciation must match; a holding&apos;s net income
        diverges by construction (K-1). &ldquo;No return&rdquo; = has QBO but the return is missing to check against;
        &ldquo;no QBO&rdquo; = has a return but the year&apos;s P&L is missing (or it is a foreign/closed entity).
      </p>
    </div>
  );
}
