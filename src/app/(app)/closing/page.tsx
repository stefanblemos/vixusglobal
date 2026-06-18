import Link from "next/link";
import { buildCompleteness, type Cell } from "@/lib/closing/completeness";

export const dynamic = "force-dynamic";

const COLS: { key: "ir" | "pnl" | "bs" | "gl" | "bank"; label: string }[] = [
  { key: "ir", label: "Return (IR)" },
  { key: "pnl", label: "P&L" },
  { key: "bs", label: "Balance Sheet" },
  { key: "gl", label: "General Ledger" },
  { key: "bank", label: "Bank" },
];

export default async function ClosingPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const wanted = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

  // Descobre os anos disponíveis usando o ano corrente como semente.
  const probe = await buildCompleteness(wanted ?? currentYear - 1);
  const years = probe.years.length > 0 ? probe.years : [currentYear - 1];
  const year = wanted ?? (years.includes(currentYear - 1) ? currentYear - 1 : years[0]);
  const { rows } = wanted === year ? probe : await buildCompleteness(year);

  const existing = rows.filter((r) => r.existed);
  const fullyComplete = existing.filter((r) => r.complete === COLS.length).length;
  const missingByCol = COLS.map((c) => ({
    label: c.label,
    missing: existing.filter((r) => !r[c.key].ok).length,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Closing — completeness</h1>
        <p className="text-sm text-slate-500">
          What&rsquo;s on file to close each company&rsquo;s year — return, P&amp;L, balance sheet,
          general ledger and bank statement. Red means it&rsquo;s missing.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Year:</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/closing?year=${y}`}
            className={`rounded-full px-3 py-1 ${y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {y}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={`Complete (${year})`} value={`${fullyComplete} / ${existing.length}`} good={existing.length > 0 && fullyComplete === existing.length} />
        {missingByCol
          .filter((m) => m.missing > 0)
          .slice(0, 3)
          .map((m) => (
            <Stat key={m.label} label={`Missing ${m.label}`} value={String(m.missing)} good={false} />
          ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">Company</th>
              {COLS.map((c) => (
                <th key={c.key} className="px-3 py-3 text-center font-medium">
                  {c.label}
                </th>
              ))}
              <th className="px-3 py-3 text-center font-medium">Complete</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={COLS.length + 2} className="px-4 py-4 text-sm text-slate-400">
                  No group companies existed in {year}.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.companyId}
                  className={r.existed ? "hover:bg-slate-50/60" : "bg-slate-50/40 text-slate-400"}
                >
                  <td className="px-4 py-3">
                    {r.existed ? (
                      <Link
                        href={`/companies/${r.companyId}/year/${year}`}
                        className="font-medium text-[#1f3a5f] hover:underline"
                      >
                        {r.companyName}
                      </Link>
                    ) : (
                      <span className="font-medium text-slate-400">{r.companyName}</span>
                    )}
                  </td>
                  {!r.existed ? (
                    <>
                      <td colSpan={COLS.length} className="px-3 py-3 text-center text-xs text-slate-400">
                        N/A — not yet incorporated in {year}
                      </td>
                      <td className="px-3 py-3 text-center text-xs text-slate-400">N/A</td>
                    </>
                  ) : (
                    <>
                      {COLS.map((c) => (
                        <td key={c.key} className="px-3 py-3 text-center">
                          <Mark cell={r[c.key]} />
                        </td>
                      ))}
                      <td className="px-3 py-3 text-center">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            r.complete === COLS.length
                              ? "bg-green-50 text-green-700"
                              : r.complete === 0
                                ? "bg-red-50 text-red-700"
                                : "bg-amber-50 text-amber-700"
                          }`}
                        >
                          {r.complete}/{COLS.length}
                        </span>
                      </td>
                    </>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        Group companies that already existed in {year}. Upload missing items in Documents (QBO
        reports / bank) or Tax (returns).
      </p>
    </div>
  );
}

function Mark({ cell }: { cell: Cell }) {
  return cell.ok ? (
    <span className="font-medium text-green-600">✓</span>
  ) : (
    <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-600">missing</span>
  );
}

function Stat({ label, value, good }: { label: string; value: string; good: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className={`text-2xl font-semibold ${good ? "text-emerald-600" : "text-amber-600"}`}>
        {value}
      </div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
