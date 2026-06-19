import Link from "next/link";
import {
  buildTaxReserve,
  buildQuarterlyReserve,
  reserveYears,
  QUARTER_DUE,
} from "@/lib/tax/reserve";
import { yearRates } from "@/lib/tax/reserve";
import { setReserveRate, setTaxRateYear } from "@/lib/actions/reserve";
import { prisma } from "@/lib/db";
import { YearSelect } from "@/components/year-select";
import { CompletenessModal } from "@/components/completeness-modal";
import { buildGroupCompleteness } from "@/lib/tax/group-completeness";
import { ReserveDepositModal, type DepositRow } from "@/components/reserve-deposit-modal";
import { buildQuarterlyBreakdown } from "@/lib/tax/quarterly-breakdown";
import { QuarterlyBreakdown } from "@/components/quarterly-breakdown";

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
  searchParams: Promise<{ year?: string; tab?: string }>;
}) {
  const { year: yearRaw, tab: tabRaw } = await searchParams;
  const years = await reserveYears();
  const fallbackYear = years[0] ?? new Date().getFullYear();
  const year = yearRaw && years.includes(Number(yearRaw)) ? Number(yearRaw) : fallbackYear;
  const TABS = [
    { key: "quarterly", label: "Quarterly" },
    { key: "annual", label: "Annual" },
    { key: "owners", label: "Owners / K-1" },
    { key: "settings", label: "Settings" },
  ];
  const tab = TABS.some((t) => t.key === tabRaw) ? tabRaw! : "quarterly";
  const rates = await yearRates(year);

  const [{ rows, flow }, { rows: qRows }, { rows: breakdown }, completeness, depositList] =
    await Promise.all([
      buildTaxReserve(year),
      buildQuarterlyReserve(year),
      buildQuarterlyBreakdown(year),
      buildGroupCompleteness(year),
      prisma.reserveDeposit.findMany({
        where: { year },
        include: { company: { select: { legalName: true } } },
        orderBy: [{ quarter: "asc" }, { createdAt: "asc" }],
      }),
    ]);
  const deposits: DepositRow[] = depositList.map((d) => ({
    id: d.id,
    company: d.company.legalName,
    quarter: d.quarter,
    amount: Number(d.amount.toString()),
    purpose: d.purpose,
    qboRef: d.qboRef,
    depositedAt: d.depositedAt ? d.depositedAt.toISOString().slice(0, 10) : null,
    note: d.note,
  }));
  const depositCompanies = qRows.map((q) => ({ id: q.companyId, name: q.name }));

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
        <div className="flex items-center gap-2">
          <CompletenessModal data={completeness} />
          {years.length > 0 && <YearSelect years={years} value={year} basePath="/reserve" />}
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/reserve?year=${year}&tab=${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 ${
              t.key === tab
                ? "border-[#1f3a5f] font-medium text-[#1f3a5f]"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {tab === "settings" && (
        <section className="space-y-3">
          <div>
            <h2 className="text-lg font-medium text-slate-800">Provision rates — {year}</h2>
            <p className="text-sm text-slate-500">
              Rates used to estimate the reserve. C-corps use the federal corporate rate;
              pass-through entities and individuals use a blended provision rate. Florida corporate
              tax applies to C-corps above the exemption. Set per year — adjust as the law changes.
            </p>
          </div>
          <form
            action={setTaxRateYear}
            className="grid grid-cols-2 gap-4 rounded-xl border border-slate-200 bg-white p-5 md:grid-cols-4"
          >
            <input type="hidden" name="year" value={year} />
            <RateField name="corpPct" label="C-corp (federal)" value={rates.corpPct} suffix="%" />
            <RateField name="passPct" label="LLC / pass-through / PF" value={rates.passPct} suffix="%" />
            <RateField name="flPct" label="Florida corporate" value={rates.flPct} suffix="%" />
            <RateField name="flExemption" label="Florida exemption" value={rates.flExemption} suffix="$" />
            <div className="col-span-2 md:col-span-4">
              <button className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]">
                Save rates
              </button>
            </div>
          </form>
          <p className="text-xs text-slate-400">
            Per-company overrides still apply on top (set them in the Annual tab&apos;s rate column).
            These rates only seed the current and prior year — older years are archived.
          </p>
        </section>
      )}

      {tab !== "settings" && rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No Profit &amp; Loss on file yet. Import one in{" "}
          <Link href="/import" className="text-[#1f3a5f] hover:underline">
            Documents
          </Link>{" "}
          to see the reserve.
        </div>
      ) : tab === "settings" ? null : (
        <>
          {tab === "quarterly" && (
          <>
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-medium text-slate-800">Quarterly closing — needed vs funded</h2>
              <ReserveDepositModal year={year} companies={depositCompanies} deposits={deposits} />
            </div>
            <p className="text-sm text-slate-500">
              Per quarter, the amount to set aside (aligned to the estimated-tax deadlines) and what
              you&apos;ve actually moved into the reserve. Gap = still to fund.
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
                    <th className="px-3 py-2 text-right font-medium">FY needed</th>
                    <th className="px-3 py-2 text-right font-medium">Funded</th>
                    <th className="px-4 py-2 text-right font-medium">Gap</th>
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
                          title={`${cell.profit != null ? `Profit ${money(cell.profit, q.currency)} · ` : ""}Funded ${money(cell.funded, q.currency)}`}
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
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                        {money(q.fyReserve, q.currency)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                        {money(q.fyFunded, q.currency)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-medium tabular-nums ${
                          q.fyGap <= 0.005 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {q.fyGap <= 0.005 ? "funded ✓" : money(q.fyGap, q.currency)}
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
                    const inCcy = qRows.filter((q) => q.currency === ccy);
                    const fy = inCcy.reduce((s, q) => s + q.fyReserve, 0);
                    const funded = inCcy.reduce((s, q) => s + q.fyFunded, 0);
                    const gap = Math.round((fy - funded) * 100) / 100;
                    return (
                      <tr key={ccy}>
                        <td className="px-4 py-2 font-medium text-slate-700">Total ({ccy})</td>
                        {qTot.map((t, i) => (
                          <td key={i} className="px-3 py-2 text-right font-medium tabular-nums text-slate-700">
                            {money(t, ccy)}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                          {money(fy, ccy)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-600">
                          {money(funded, ccy)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-semibold tabular-nums ${
                            gap <= 0.005 ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {gap <= 0.005 ? "funded ✓" : money(gap, ccy)}
                        </td>
                      </tr>
                    );
                  })}
                </tfoot>
              </table>
            </div>
          </section>
          <QuarterlyBreakdown rows={breakdown} />
          </>
          )}

          {tab === "annual" && (
          <>
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
          </>
          )}

          {tab === "owners" && flow.length > 0 && (
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

function RateField({
  name,
  label,
  value,
  suffix,
}: {
  name: string;
  label: string;
  value: number;
  suffix: string;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-slate-600">{label}</label>
      <div className="flex items-center gap-1">
        {suffix === "$" && <span className="text-sm text-slate-400">$</span>}
        <input
          type="number"
          name={name}
          defaultValue={value}
          step={suffix === "$" ? "1000" : "0.5"}
          min="0"
          className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-right text-sm"
        />
        {suffix === "%" && <span className="text-sm text-slate-400">%</span>}
      </div>
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
