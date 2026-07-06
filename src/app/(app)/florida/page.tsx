import Link from "next/link";
import {
  buildFloridaForecast,
  FL_ESTIMATE_DUE,
  FL_ESTIMATE_THRESHOLD,
} from "@/lib/tax/florida";
import { reserveYears } from "@/lib/tax/reserve";
import { buildStateTaxControl } from "@/lib/tax/state-tax";
import { buildStateTaxReconciliation } from "@/lib/tax/state-tax-recon";
import { StateTaxControl } from "@/components/state-tax-control";
import { YearSelect } from "@/components/year-select";

const money = (v: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);

export const dynamic = "force-dynamic";

const TABS = ["forecast", "apuracao", "reconciliacao"] as const;

export default async function FloridaPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; tab?: string }>;
}) {
  const { year: yearRaw, tab: tabRaw } = await searchParams;
  const years = await reserveYears();
  const fallback = years[0] ?? new Date().getFullYear();
  const year = yearRaw && years.includes(Number(yearRaw)) ? Number(yearRaw) : fallback;
  const tab: (typeof TABS)[number] = TABS.includes(tabRaw as (typeof TABS)[number])
    ? (tabRaw as (typeof TABS)[number])
    : "forecast";

  const [f, stateTax, recon] = await Promise.all([
    buildFloridaForecast(year),
    buildStateTaxControl(),
    buildStateTaxReconciliation(year),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Florida corporate tax</h1>
          <p className="text-sm text-slate-500">
            {tab === "forecast"
              ? `Florida Corporate Income Tax (F-1120) on C-corporations only — ${f.rate}% of Florida net income above the ${money(f.exemption)} exemption.`
              : "Assessment & actual payment of state tax (principal · penalty · interest) per year — basis for the Schedule M-1 add-back."}
          </p>
        </div>
        {tab !== "apuracao" && years.length > 0 && (
          <YearSelect years={years} value={year} basePath="/florida" params={{ tab }} />
        )}
      </div>

      {/* Abas */}
      <div className="flex gap-1 border-b border-slate-200 text-sm">
        {([["forecast", "Forecast"], ["apuracao", "Assessment & payment"], ["reconciliacao", "Reconciliation"]] as [string, string][]).map(([key, label]) => (
          <Link
            key={key}
            href={`/florida?tab=${key}`}
            className={`-mb-px border-b-2 px-4 py-2 ${
              tab === key ? "border-[#1f3a5f] font-medium text-[#1f3a5f]" : "border-transparent text-slate-500 hover:text-slate-800"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "apuracao" && <StateTaxControl data={stateTax} />}

      {tab === "reconciliacao" && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-medium text-slate-800">Reconciliation — book × payments ({year})</h2>
            <p className="text-sm text-slate-500">
              The <strong>&ldquo;State Taxes&rdquo;</strong> line on the {year} P&amp;L is state tax from{" "}
              <strong>prior</strong> years paid in {year} (may mix several years). The M-1 add-back
              (principal + penalty come back; interest stays deductible) is only reliable when{" "}
              <strong>Σ registered payments = the P&amp;L line</strong>. Where it doesn&apos;t reconcile, the
              payment still needs to be registered in{" "}
              <Link href="/florida?tab=apuracao" className="text-[#1f3a5f] hover:underline">Assessment</Link>.
            </p>
          </div>
          {recon.rows.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              No company with &ldquo;State Taxes&rdquo; on the P&amp;L nor a payment in {year}.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Company</th>
                    <th className="px-3 py-2 text-right font-medium">State Taxes (P&amp;L)</th>
                    <th className="px-3 py-2 text-right font-medium">Paid (filings)</th>
                    <th className="px-3 py-2 text-right font-medium">Δ</th>
                    <th className="px-3 py-2 text-right font-medium">Add-back / juros</th>
                    <th className="px-3 py-2 text-center font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {recon.rows.map((r) => (
                    <tr key={r.companyId} className={r.reconciles ? "" : "bg-amber-50/40"}>
                      <td className="px-4 py-2">
                        <Link href={`/companies/${r.companyId}`} className="font-medium text-[#1f3a5f] hover:underline">{r.name}</Link>
                        {r.filings.length > 0 && (
                          <div className="text-[11px] text-slate-400">
                            {r.filings.map((f, i) => (
                              <span key={i}>
                                {i > 0 && " · "}
                                {f.taxYear}: {money(f.total)}{" "}
                                {f.irPrincipal == null ? (
                                  <span className="text-slate-400" title="Tax return for the year is not in the app — principal not verified">(return missing)</span>
                                ) : f.principalOk ? (
                                  <span className="text-green-600" title={`principal matches the tax return (${money(f.irPrincipal)})`}>(return ✓)</span>
                                ) : (
                                  <span className="text-rose-600" title={`principal ≠ tax return (${money(f.irPrincipal)}) — check`}>(return ≠)</span>
                                )}
                              </span>
                            ))}
                          </div>
                        )}
                        {!r.hasPnl && <span className="ml-1 text-[10px] text-amber-600">no P&amp;L</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(r.pnlStateTaxes)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(r.filingsPaid)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums ${r.reconciles ? "text-slate-400" : "font-medium text-amber-700"}`}>{money(r.delta)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                        {r.reconciles ? (
                          <span title="principal + penalty come back to the base; interest stays deductible">
                            {money(r.addBack)} <span className="text-[11px] text-slate-400">/ {money(r.deductibleInterest)}</span>
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {r.reconciles ? (
                          <span className="text-green-600" title="reconciles — add-back reliable">✓</span>
                        ) : (
                          <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700" title="payment still to be registered — don't trust the add-back">
                            missing {money(Math.abs(r.delta))}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {recon.unreconciled > 0 && (
            <p className="text-xs text-amber-700">
              ⚠ {recon.unreconciled} company(ies) don&apos;t reconcile — the preview/reserve should <strong>not</strong>
              add their state tax back until the payments are registered.
            </p>
          )}
        </section>
      )}

      {tab === "forecast" && (
      <>
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
      </>
      )}
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
