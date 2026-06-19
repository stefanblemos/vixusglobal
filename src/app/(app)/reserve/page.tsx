import Link from "next/link";
import {
  buildTaxReserve,
  buildQuarterlyReserve,
  reserveYears,
  GLOBAL_RATE_KEY,
  QUARTER_DUE,
} from "@/lib/tax/reserve";
import { setReserveRate } from "@/lib/actions/reserve";
import { prisma } from "@/lib/db";
import { YearSelect } from "@/components/year-select";

const money = (v: number | null, ccy = "USD") =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: ccy,
        maximumFractionDigits: 0,
      }).format(v);

export default async function ReservePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearRaw } = await searchParams;
  const years = await reserveYears();
  const fallbackYear = years[0] ?? new Date().getFullYear();
  const year = yearRaw && years.includes(Number(yearRaw)) ? Number(yearRaw) : fallbackYear;

  const [{ rows, flow }, { rows: qRows }, globalRateRow] = await Promise.all([
    buildTaxReserve(year),
    buildQuarterlyReserve(year),
    prisma.taxReserveRate.findUnique({ where: { companyId: GLOBAL_RATE_KEY } }),
  ]);
  const globalRate = Number(globalRateRow?.ratePct ?? 30);

  // Total a reservar por moeda (não dá pra somar USD + BRL + EUR).
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.reserve);
  const anyAssets = rows.some((r) => r.hasAssets);
  // Comparação da compensação (em USD): reserva por empresa (sem abater) × net por dono.
  const grossUsd = rows.filter((r) => r.currency === "USD").reduce((s, r) => s + r.reserve, 0);
  const netUsd = flow.reduce((s, f) => s + f.reserve, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Tax reserve</h1>
          <p className="text-sm text-slate-500">
            How much profit to set aside for taxes. For the selected year, each company shows its
            profit and the slice to move into a dedicated tax-reserve account — so the cash is there
            when the bill comes.
          </p>
        </div>
        {years.length > 0 && <YearSelect years={years} value={year} basePath="/reserve" />}
      </div>

      {/* Default rate */}
      <form
        action={setReserveRate}
        className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3"
      >
        <span className="text-sm font-medium text-slate-700">Default reserve rate</span>
        <span className="text-xs text-slate-500">applied to every company without an override</span>
        <span className="ml-auto flex items-center gap-2">
          <input
            type="number"
            name="ratePct"
            defaultValue={globalRate}
            step="0.5"
            min="0"
            max="100"
            className="w-20 rounded-lg border border-slate-300 px-2 py-1 text-right text-sm"
          />
          <span className="text-sm text-slate-500">%</span>
          <button className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16314f]">
            Save
          </button>
        </span>
      </form>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No Profit &amp; Loss on file yet. Import one in{" "}
          <Link href="/import" className="text-[#1f3a5f] hover:underline">
            Documents
          </Link>{" "}
          to see the reserve.
        </div>
      ) : (
        <>
          <section className="space-y-2">
            <h2 className="text-lg font-medium text-slate-800">Quarterly closing — set aside per quarter</h2>
            <p className="text-sm text-slate-500">
              The amount to move into the reserve each quarter, aligned to the estimated-tax
              deadlines. Companies with only an annual P&amp;L show the full year (no quarterly split).
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Company</th>
                    {QUARTER_DUE.map((due, i) => (
                      <th key={i} className="px-3 py-2 text-right font-medium">
                        Q{i + 1}
                        <span className="block text-[10px] font-normal text-slate-400">due {due}</span>
                      </th>
                    ))}
                    <th className="px-4 py-2 text-right font-medium">FY reserve</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {qRows.map((q) => (
                    <tr key={q.companyId} className="hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <Link
                          href={`/companies/${q.companyId}`}
                          className="font-medium text-[#1f3a5f] hover:underline"
                        >
                          {q.name}
                        </Link>
                        {q.annualOnly && (
                          <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                            annual only
                          </span>
                        )}
                      </td>
                      {q.quarters.map((cell, i) => (
                        <td
                          key={i}
                          className="px-3 py-2 text-right tabular-nums text-slate-700"
                          title={cell.profit != null ? `Profit ${money(cell.profit, q.currency)}` : undefined}
                        >
                          {q.annualOnly ? (
                            <span className="text-slate-300">—</span>
                          ) : cell.profit == null ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            money(cell.reserve, q.currency)
                          )}
                        </td>
                      ))}
                      <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                        {money(q.fyReserve, q.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50/60">
                  {[...totals.entries()].map(([ccy]) => {
                    const qTot = [0, 1, 2, 3].map((i) =>
                      qRows
                        .filter((q) => q.currency === ccy && !q.annualOnly)
                        .reduce((s, q) => s + q.quarters[i].reserve, 0),
                    );
                    const fy = qRows.filter((q) => q.currency === ccy).reduce((s, q) => s + q.fyReserve, 0);
                    return (
                      <tr key={ccy}>
                        <td className="px-4 py-2 font-medium text-slate-700">Total ({ccy})</td>
                        {qTot.map((t, i) => (
                          <td key={i} className="px-3 py-2 text-right font-medium tabular-nums text-slate-700">
                            {money(t, ccy)}
                          </td>
                        ))}
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                          {money(fy, ccy)}
                        </td>
                      </tr>
                    );
                  })}
                </tfoot>
              </table>
            </div>
          </section>

          <h2 className="text-lg font-medium text-slate-800">
            Annual — depreciation-adjusted, with loss compensation
          </h2>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 text-right font-medium">Book profit</th>
                  {anyAssets && (
                    <th className="px-3 py-2 text-right font-medium">Depreciation book → tax</th>
                  )}
                  <th className="px-3 py-2 text-right font-medium">Taxable profit</th>
                  <th className="px-3 py-2 text-right font-medium">Rate</th>
                  <th className="px-4 py-2 text-right font-medium">Reserve</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.companyId} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <Link
                        href={`/companies/${r.companyId}`}
                        className="font-medium text-[#1f3a5f] hover:underline"
                      >
                        {r.name}
                      </Link>
                      <div className="text-xs text-slate-400">
                        {r.importId ? (
                          <Link href={`/import/${r.importId}`} className="hover:underline">
                            {r.periodLabel}
                          </Link>
                        ) : (
                          r.periodLabel
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {money(r.profit, r.currency)}
                    </td>
                    {anyAssets && (
                      <td className="px-3 py-2 text-right text-xs tabular-nums">
                        {r.hasAssets ? (
                          <span title={`Book dep ${money(r.bookDep, r.currency)} − Tax dep ${money(r.taxDep, r.currency)}`}>
                            <span className="text-slate-400">
                              {money(r.bookDep, r.currency)} → {money(r.taxDep, r.currency)}
                            </span>
                            <span
                              className={`ml-1 ${r.depAdjustment < 0 ? "text-rose-600" : "text-emerald-600"}`}
                            >
                              ({r.depAdjustment >= 0 ? "+" : ""}
                              {money(r.depAdjustment, r.currency)})
                            </span>
                          </span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-800">
                      {money(r.taxableProfit, r.currency)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <form action={setReserveRate} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="companyId" value={r.companyId} />
                        <input
                          type="number"
                          name="ratePct"
                          defaultValue={r.ratePct}
                          step="0.5"
                          min="0"
                          max="100"
                          className={`w-14 rounded border px-1.5 py-0.5 text-right text-xs ${
                            r.hasOverride ? "border-[#1f3a5f] text-[#1f3a5f]" : "border-slate-200"
                          }`}
                        />
                        <button className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
                          set
                        </button>
                      </form>
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {money(r.reserve, r.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50/60">
                {[...totals.entries()].map(([ccy, total]) => (
                  <tr key={ccy}>
                    <td className="px-4 py-2 font-medium text-slate-700" colSpan={anyAssets ? 5 : 4}>
                      Total to move into the reserve account ({ccy})
                    </td>
                    <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                      {money(total, ccy)}
                    </td>
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>

          {flow.length > 0 && (
            <section className="space-y-2">
              <h2 className="text-lg font-medium text-slate-800">
                Profit flow to owners — with loss compensation
              </h2>
              <p className="text-sm text-slate-500">
                Each company&apos;s taxable profit (or loss) attributed to its direct owners. Losses
                offset profits at the owner level, so the reserve is on the net base — not on each
                profit alone.
              </p>
              <div className="grid grid-cols-3 gap-3">
                <Stat label="Gross reserve (USD, no offset)" value={money(grossUsd, "USD")} muted />
                <Stat label="After loss compensation" value={money(netUsd, "USD")} />
                <Stat label="Saved by offsetting losses" value={money(grossUsd - netUsd, "USD")} good />
              </div>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-2 font-medium">Owner</th>
                      <th className="px-4 py-2 font-medium">From (profit / loss)</th>
                      <th className="px-4 py-2 text-right font-medium">Net base</th>
                      <th className="px-4 py-2 text-right font-medium">Reserve ({flow[0]?.ratePct ?? 0}%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {flow.map((f) => (
                      <tr key={f.name}>
                        <td className="px-4 py-2 font-medium text-slate-700">{f.name}</td>
                        <td className="px-4 py-2 text-xs text-slate-500">
                          {f.from.map((x, i) => (
                            <span key={i}>
                              {i > 0 && " · "}
                              {x.company} (
                              <span className={x.amount < 0 ? "text-rose-600" : "text-slate-500"}>
                                {money(x.amount, "USD")}
                              </span>
                              )
                            </span>
                          ))}
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums ${f.net < 0 ? "text-rose-600" : "text-slate-800"}`}
                        >
                          {money(f.net, "USD")}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                          {money(f.reserve, "USD")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <p className="text-xs text-slate-400">
            Taxable profit = book net income, swapping booked depreciation for the computed{" "}
            <Link href="/assets" className="text-[#1f3a5f] hover:underline">
              MACRS depreciation
            </Link>{" "}
            where assets are on file (book − tax). At the owner level, losses compensate profits, so
            the reserve is on the net base (the company table shows each entity&apos;s standalone
            figure). Direct ownership only, USD; reconcile against the actual return at year-end.{" "}
            <Link href="/florida" className="text-[#1f3a5f] hover:underline">
              Florida corporate tax →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  good,
  muted,
}: {
  label: string;
  value: string;
  good?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold ${
          good ? "text-emerald-600" : muted ? "text-slate-400" : "text-slate-800"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
