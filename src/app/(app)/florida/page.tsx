import Link from "next/link";
import {
  buildFloridaForecast,
  FL_ESTIMATE_DUE,
  FL_ESTIMATE_THRESHOLD,
} from "@/lib/tax/florida";
import { reserveYears } from "@/lib/tax/reserve";
import { YearSelect } from "@/components/year-select";

const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

export const dynamic = "force-dynamic";

export default async function FloridaPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearRaw } = await searchParams;
  const years = await reserveYears();
  const fallback = years[0] ?? new Date().getFullYear();
  const year = yearRaw && years.includes(Number(yearRaw)) ? Number(yearRaw) : fallback;

  const f = await buildFloridaForecast(year);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Florida corporate tax — forecast</h1>
          <p className="text-sm text-slate-500">
            Florida Corporate Income Tax (F-1120) on C-corporations only — {f.rate}% of Florida net
            income above the {money(f.exemption)} exemption. Based on the depreciation-adjusted
            taxable profit; income assumed 100% Florida.
          </p>
        </div>
        {years.length > 0 && <YearSelect years={years} value={year} basePath="/florida" />}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label={`C-corps in FL (${year})`} value={String(f.rows.length)} />
        <Stat label="Estimated FL tax" value={money(f.totalTax)} strong />
        <Stat label="Rate / exemption" value={`${f.rate}% · ${money(f.exemption)}`} />
      </div>

      {f.rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No Florida C-corporations with a P&amp;L for {year}. Florida corporate income tax applies
          only to C-corps; set a company&apos;s state to FL and its tax treatment to C-corp (from its
          latest return) to see it here.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 text-right font-medium">Taxable profit</th>
                <th className="px-4 py-2 text-right font-medium">Exemption</th>
                <th className="px-4 py-2 text-right font-medium">FL taxable</th>
                <th className="px-4 py-2 text-right font-medium">FL tax ({f.rate}%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {f.rows.map((r) => (
                <tr key={r.companyId} className="hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <Link
                      href={`/companies/${r.companyId}`}
                      className="font-medium text-[#1f3a5f] hover:underline"
                    >
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                    {money(r.taxableProfit)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                    −{money(r.exemptionApplied)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                    {money(r.flTaxable)}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {money(r.flTax)}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-slate-200 bg-slate-50/60">
              <tr>
                <td className="px-4 py-2 font-medium text-slate-700" colSpan={4}>
                  Total estimated Florida corporate income tax
                </td>
                <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                  {money(f.totalTax)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {f.rows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium text-slate-800">
            Quarterly estimated payments (F-1120ES)
          </h2>
          <p className="text-sm text-slate-500">
            Florida requires estimated corporate tax when the year&apos;s tax exceeds{" "}
            {money(FL_ESTIMATE_THRESHOLD)} — paid in four installments. Each installment is roughly a
            quarter of the estimated tax.
          </p>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  {FL_ESTIMATE_DUE.map((due, i) => (
                    <th key={i} className="px-3 py-2 text-right font-medium">
                      Inst. {i + 1}
                      <span className="block text-[10px] font-normal text-slate-400">due {due}</span>
                    </th>
                  ))}
                  <th className="px-4 py-2 text-right font-medium">FY tax</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {f.rows.map((r) => (
                  <tr key={r.companyId} className={r.estimateRequired ? "" : "text-slate-400"}>
                    <td className="px-4 py-2 font-medium text-slate-700">
                      {r.name}
                      {!r.estimateRequired && (
                        <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                          under threshold
                        </span>
                      )}
                    </td>
                    {FL_ESTIMATE_DUE.map((_, i) => (
                      <td key={i} className="px-3 py-2 text-right tabular-nums text-slate-700">
                        {r.estimateRequired ? money(r.installment) : "—"}
                      </td>
                    ))}
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {money(r.flTax)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-amber-600">
            ⚠️ Installment due dates are the standard last-day-of-month-4/6/9 and year-end pattern —
            confirm the exact F-1120ES dates and the first-installment trigger with the accountant.
          </p>
        </section>
      )}

      {f.passThroughFl.length > 0 && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
          <div className="text-sm font-medium text-slate-700">
            Florida pass-through entities — no state income tax
          </div>
          <p className="mt-1 text-xs text-slate-500">
            These FL companies don&apos;t pay Florida corporate income tax (income passes to the
            owners): {f.passThroughFl.map((p) => p.name).join(" · ")}
          </p>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Estimate only. Florida starts from federal taxable income with state additions/subtractions
        and apportionment; here income is taken 100% to Florida and the standard {f.rate}% rate is
        used. Confirm the rate for the year, NOL rules, and apportionment with the accountant.
      </p>
    </div>
  );
}

function Stat({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${strong ? "text-[#1f3a5f]" : "text-slate-800"}`}>
        {value}
      </div>
    </div>
  );
}
