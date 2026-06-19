import { QUARTER_DUE } from "@/lib/tax/reserve";
import type { QBreakdownRow, QComp } from "@/lib/tax/quarterly-breakdown";

const money = (v: number, ccy = "USD") =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(v);

const LINES: { label: string; get: (c: QComp) => number; emphasis?: boolean; muted?: boolean }[] = [
  { label: "Period profit", get: (c) => c.profit },
  { label: "+ Interest receivable", get: (c) => c.interestIn },
  { label: "− Interest payable", get: (c) => c.interestOut, muted: true },
  { label: "− Depreciation (MACRS)", get: (c) => c.depreciation, muted: true },
  { label: "± K-1 from investees", get: (c) => c.k1 },
  { label: "= Taxable base", get: (c) => c.base, emphasis: true },
];

export function QuarterlyBreakdown({ rows }: { rows: QBreakdownRow[] }) {
  const shown = rows.filter((r) => r.fy.base !== 0 || r.missing.length > 0 || r.fy.profit !== 0);
  if (shown.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium text-slate-800">Base build-up — every variable per quarter</h2>
      <p className="text-sm text-slate-500">
        How each company&apos;s taxable base is built: profit, intercompany interest (in/out),
        depreciation and K-1 from investees → base → tax. Open a company to see the quarters.
      </p>

      {shown.map((r) => (
        <details key={r.companyId} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3">
            <span className="font-medium text-slate-800">{r.name}</span>
            <span className="text-xs text-slate-400">
              FY base {money(r.fy.base, r.currency)} · tax {money(r.fy.tax, r.currency)} @ {r.ratePct}%
            </span>
            {r.annualOnly && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">annual only</span>
            )}
            {r.missing.length > 0 && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                base incomplete
              </span>
            )}
          </summary>

          <div className="overflow-x-auto border-t border-slate-100">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">Component</th>
                  {QUARTER_DUE.map((due, i) => (
                    <th key={i} className="px-3 py-2 text-right font-medium">
                      Q{i + 1}
                      <span className="block text-[10px] font-normal text-slate-400">{due}</span>
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right font-medium">FY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {LINES.map((ln) => (
                  <tr key={ln.label} className={ln.emphasis ? "bg-slate-50/60" : ""}>
                    <td className={`px-4 py-1.5 ${ln.emphasis ? "font-medium text-slate-700" : ln.muted ? "text-slate-500" : "text-slate-600"}`}>
                      {ln.label}
                    </td>
                    {r.quarters.map((q, i) => (
                      <td key={i} className="px-3 py-1.5 text-right tabular-nums text-slate-600">
                        {q == null ? <span className="text-slate-300">—</span> : money(ln.get(q), r.currency)}
                      </td>
                    ))}
                    <td className={`px-4 py-1.5 text-right tabular-nums ${ln.emphasis ? "font-semibold text-slate-900" : "text-slate-600"}`}>
                      {money(ln.get(r.fy), r.currency)}
                    </td>
                  </tr>
                ))}
                <tr className="bg-[#1f3a5f]/[0.04]">
                  <td className="px-4 py-1.5 font-medium text-[#1f3a5f]">Tax ({r.ratePct}%)</td>
                  {r.quarters.map((q, i) => (
                    <td key={i} className="px-3 py-1.5 text-right font-medium tabular-nums text-[#1f3a5f]">
                      {q == null ? <span className="text-slate-300">—</span> : money(q.tax, r.currency)}
                    </td>
                  ))}
                  <td className="px-4 py-1.5 text-right font-semibold tabular-nums text-[#1f3a5f]">
                    {money(r.fy.tax, r.currency)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {r.missing.length > 0 && (
            <div className="border-t border-slate-100 bg-amber-50/40 px-4 py-2 text-xs text-amber-700">
              Base incomplete — {r.missing.join(" · ")}
            </div>
          )}
        </details>
      ))}
    </section>
  );
}
