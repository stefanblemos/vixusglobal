import { resolveWanted } from "@/lib/year";
import Link from "next/link";
import { buildConsolidation, buildConsolidationSeries } from "@/lib/consolidation/build";

export const dynamic = "force-dynamic";

const M = (n: number | null) => (n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n));
const C = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 1 }).format(n);

export default async function ConsolidationPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: yParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const wanted = await resolveWanted(yParam);

  const probe = await buildConsolidation(wanted ?? currentYear - 1);
  const years = probe.years.length ? probe.years : [currentYear - 1];
  const year = wanted ?? (years.includes(currentYear - 1) ? currentYear - 1 : years[0]);
  const data = wanted === year ? probe : await buildConsolidation(year);
  const series = await buildConsolidationSeries(years.filter((y) => y >= currentYear - 5).sort((a, b) => a - b));
  const maxNi = Math.max(1, ...series.map((p) => Math.abs(p.netIncome)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Group consolidation</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          The group as <strong>one economic unit</strong>: sum of the companies&apos; financials (USD),
          eliminating the <strong>confirmed intercompany debt</strong> (both sides match). Whatever doesn&apos;t
          close cleanly is shown under &ldquo;to review&rdquo; — and becomes exact as the companies adopt the{" "}
          <Link href="/coa" className="text-sky-700 underline">canonical chart</Link>.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Year:</span>
        {years.map((y) => (
          <Link key={y} href={`/consolidation?year=${y}`} className={`rounded-full px-3 py-1 ${y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{y}</Link>
        ))}
      </div>

      {/* headline consolidado */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border-2 border-[#8DC63F]/60 bg-[#8DC63F]/[0.08] p-4">
          <div className="text-xs text-slate-600">Consolidated net income ({year})</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-[#3B6D11]">{M(data.consolidated.netIncome)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Consolidated assets</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{M(data.consolidated.assets)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Equity</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{M(data.consolidated.equity)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Revenue</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{M(data.consolidated.revenue)}</div>
        </div>
      </div>

      <p className="text-xs text-slate-500">
        Gross (without eliminating): assets {M(data.gross.assets)} · liabilities {M(data.gross.liabilities)}.{" "}
        <strong className="text-slate-700">Eliminated {M(data.intercompanyEliminated)}</strong> of confirmed intercompany debt.{" "}
        {data.flaggedCount > 0 && <span className="text-amber-700">{data.flaggedCount} positions to review (below).</span>}
      </p>

      {/* trajetória */}
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-3 text-sm font-medium text-slate-700">Trajectory — consolidated net income by year</div>
        <div className="flex items-end gap-3">
          {series.map((p) => (
            <Link key={p.year} href={`/consolidation?year=${p.year}`} className="group flex flex-1 flex-col items-center gap-1">
              <div className="text-[11px] font-medium tabular-nums text-slate-500 group-hover:text-slate-800">{C(p.netIncome)}</div>
              <div className="flex h-32 w-full items-end">
                <div
                  className={`w-full rounded-t ${p.year === year ? "bg-[#3B6D11]" : "bg-[#8DC63F]/60 group-hover:bg-[#8DC63F]"}`}
                  style={{ height: `${Math.max(2, (Math.abs(p.netIncome) / maxNi) * 100)}%` }}
                />
              </div>
              <div className={`text-xs ${p.year === year ? "font-semibold text-slate-800" : "text-slate-400"}`}>{p.year}</div>
              <div className="text-[10px] text-slate-400">assets {C(p.assets)}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* contribuição por empresa */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">Contribution by company ({year})</div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-1.5 font-medium">Company</th>
                <th className="px-3 py-1.5 text-right font-medium">Revenue</th>
                <th className="px-3 py-1.5 text-right font-medium">Net income</th>
                <th className="px-3 py-1.5 text-right font-medium">Assets</th>
                <th className="px-3 py-1.5 text-right font-medium">Equity</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.companies.sort((a, b) => (b.netIncome ?? 0) - (a.netIncome ?? 0)).map((r) => (
                <tr key={r.companyId} className="hover:bg-slate-50">
                  <td className="px-4 py-1.5">
                    <Link href={`/companies/${r.companyId}`} className="font-medium text-[#1f3a5f] hover:underline">{r.name}</Link>
                    {!r.hasPL && <span className="ml-1 text-[10px] text-amber-600">no P&L</span>}
                    {!r.hasBS && <span className="ml-1 text-[10px] text-amber-600">no BS</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{M(r.revenue)}</td>
                  <td className={`px-3 py-1.5 text-right tabular-nums font-medium ${(r.netIncome ?? 0) < 0 ? "text-rose-600" : "text-slate-800"}`}>{M(r.netIncome)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{M(r.assets)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{M(r.equity)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-slate-200 font-semibold">
                <td className="px-4 py-2 text-slate-700">Gross (sum)</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{M(data.gross.revenue)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{M(data.gross.netIncome)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{M(data.gross.assets)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-slate-700">{M(data.gross.equity)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* worksheet de eliminação */}
      {data.eliminations.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">Intercompany elimination worksheet</div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-50">
              {data.eliminations.map((e, i) => (
                <tr key={i} className={e.status === "a-conferir" ? "bg-amber-50/40" : ""}>
                  <td className="px-4 py-1.5 text-slate-700">{e.creditor} <span className="text-slate-300">↔</span> {e.debtor}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-slate-600">{M(e.amount)}</td>
                  <td className="px-3 py-1.5 text-[11px]">
                    <span className={`rounded-full px-2 py-0.5 ${e.status === "confirmado" ? "bg-[#8DC63F]/20 text-[#3B6D11]" : "bg-amber-100 text-amber-700"}`}>{e.status}</span>
                    <span className="ml-2 text-slate-400">{e.note}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(data.excludedForeign.length > 0 || data.missingData.length > 0) && (
        <p className="text-[11px] text-slate-400">
          {data.excludedForeign.length > 0 && <>Outside the USD consolidation (foreign currency, taxed in-country): {data.excludedForeign.join(", ")}. </>}
          {data.missingData.length > 0 && <>No BS/P&L for {year}: {data.missingData.join(", ")}. </>}
          Elimination of investment in affiliates and of intercompany income is not yet performed (requires the canonical chart) — consolidated net income is the sum of the standalone books.
        </p>
      )}
    </div>
  );
}
