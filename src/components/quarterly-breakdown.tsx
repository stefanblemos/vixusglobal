import { QUARTER_DUE } from "@/lib/tax/reserve";
import type { QBreakdownRow } from "@/lib/tax/quarterly-breakdown";

const money = (v: number | null, ccy = "USD") =>
  v == null
    ? null
    : new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(v);

const Cell = ({ v, ccy, cls = "" }: { v: number | null; ccy: string; cls?: string }) => (
  <td className={`px-3 py-1.5 text-right tabular-nums ${cls}`}>
    {v == null ? <span className="text-slate-300">—</span> : money(v, ccy)}
  </td>
);

export function QuarterlyBreakdown({ rows }: { rows: QBreakdownRow[] }) {
  const shown = rows.filter((r) => r.fy.base !== 0 || r.missing.length > 0 || r.fy.profit !== 0);
  if (shown.length === 0) return null;

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-medium text-slate-800">Base build-up — every variable per quarter</h2>
      <p className="text-sm text-slate-500">
        How each company&apos;s taxable base is built: profit, intercompany interest (in/out),
        depreciation and K-1 from investees → base → tax. Interest and K-1 are shown per quarter even
        when the profit is only annual; K-1 is broken out by investee.
      </p>

      {shown.map((r) => (
        <details key={r.companyId} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-4 py-3">
            <span className="font-medium text-slate-800">{r.name}</span>
            <span className="text-xs text-slate-400">
              FY base {money(r.fy.base, r.currency)} · tax {money(r.fy.tax, r.currency)} @ {r.ratePct}%
            </span>
            {r.annualOnly && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">annual profit</span>
            )}
            {r.missing.length > 0 && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">base incomplete</span>
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
                <tr>
                  <td className="px-4 py-1.5 text-slate-600">Period profit</td>
                  {r.quarters.map((q, i) => (
                    <Cell key={i} v={q.profit} ccy={r.currency} cls="text-slate-600" />
                  ))}
                  <Cell v={r.fy.profit} ccy={r.currency} cls="text-slate-600" />
                </tr>
                <tr>
                  <td className="px-4 py-1.5 text-slate-600">+ Interest receivable</td>
                  {r.quarters.map((q, i) => (
                    <Cell key={i} v={q.interestIn} ccy={r.currency} cls="text-slate-600" />
                  ))}
                  <Cell v={r.fy.interestIn} ccy={r.currency} cls="text-slate-600" />
                </tr>
                <tr>
                  <td className="px-4 py-1.5 text-slate-500">− Interest payable</td>
                  {r.quarters.map((q, i) => (
                    <Cell key={i} v={q.interestOut} ccy={r.currency} cls="text-slate-500" />
                  ))}
                  <Cell v={r.fy.interestOut} ccy={r.currency} cls="text-slate-500" />
                </tr>
                <tr>
                  <td className="px-4 py-1.5 text-slate-500">− Depreciation (MACRS)</td>
                  {r.quarters.map((q, i) => (
                    <Cell key={i} v={q.depreciation} ccy={r.currency} cls="text-slate-500" />
                  ))}
                  <Cell v={r.fy.depreciation} ccy={r.currency} cls="text-slate-500" />
                </tr>
                <tr>
                  <td className="px-4 py-1.5 text-slate-600">± K-1 from investees</td>
                  {r.quarters.map((q, i) => (
                    <Cell key={i} v={q.k1} ccy={r.currency} cls="text-slate-600" />
                  ))}
                  <Cell v={r.fy.k1} ccy={r.currency} cls="text-slate-600" />
                </tr>
                {r.k1Items.map((it) => (
                  <tr key={it.name} className="text-xs">
                    <td className="py-1 pl-8 pr-4 text-slate-400">↳ {it.name}</td>
                    {it.quarters.map((v, i) => (
                      <Cell key={i} v={v} ccy={r.currency} cls="text-slate-400" />
                    ))}
                    <Cell v={it.fy} ccy={r.currency} cls="text-slate-400" />
                  </tr>
                ))}
                <tr className="bg-slate-50/60">
                  <td className="px-4 py-1.5 font-medium text-slate-700">= Taxable base</td>
                  {r.quarters.map((q, i) => (
                    <Cell key={i} v={q.base} ccy={r.currency} cls="font-medium text-slate-800" />
                  ))}
                  <Cell v={r.fy.base} ccy={r.currency} cls="font-semibold text-slate-900" />
                </tr>
                <tr className="bg-[#1f3a5f]/[0.04]">
                  <td className="px-4 py-1.5 font-medium text-[#1f3a5f]">Tax ({r.ratePct}%)</td>
                  {r.quarters.map((q, i) => (
                    <Cell key={i} v={q.tax} ccy={r.currency} cls="font-medium text-[#1f3a5f]" />
                  ))}
                  <Cell v={r.fy.tax} ccy={r.currency} cls="font-semibold text-[#1f3a5f]" />
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
