import Link from "next/link";
import { buildTaxReserve, reserveYears, GLOBAL_RATE_KEY } from "@/lib/tax/reserve";
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

  const [{ rows }, globalRateRow] = await Promise.all([
    buildTaxReserve(year),
    prisma.taxReserveRate.findUnique({ where: { companyId: GLOBAL_RATE_KEY } }),
  ]);
  const globalRate = Number(globalRateRow?.ratePct ?? 30);

  // Total a reservar por moeda (não dá pra somar USD + BRL + EUR).
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.reserve);

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
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-4 py-2 font-medium">P&amp;L period</th>
                  <th className="px-4 py-2 text-right font-medium">Estimated profit</th>
                  <th className="px-4 py-2 text-right font-medium">Rate</th>
                  <th className="px-4 py-2 text-right font-medium">Reserve this period</th>
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
                    </td>
                    <td className="px-4 py-2 text-slate-500">
                      {r.importId ? (
                        <Link href={`/import/${r.importId}`} className="hover:underline">
                          {r.periodLabel}
                        </Link>
                      ) : (
                        r.periodLabel
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {money(r.profit, r.currency)}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <form action={setReserveRate} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="companyId" value={r.companyId} />
                        <input
                          type="number"
                          name="ratePct"
                          defaultValue={r.ratePct}
                          step="0.5"
                          min="0"
                          max="100"
                          className={`w-16 rounded border px-1.5 py-0.5 text-right text-xs ${
                            r.hasOverride ? "border-[#1f3a5f] text-[#1f3a5f]" : "border-slate-200"
                          }`}
                        />
                        <span className="text-xs text-slate-400">%</span>
                        <button className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100">
                          set
                        </button>
                      </form>
                    </td>
                    <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-800">
                      {money(r.reserve, r.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50/60">
                {[...totals.entries()].map(([ccy, total]) => (
                  <tr key={ccy}>
                    <td className="px-4 py-2 font-medium text-slate-700" colSpan={4}>
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

          <p className="text-xs text-slate-400">
            Estimate based on the year&apos;s P&amp;L net income (annual report, or the sum of the
            monthly ones) × the reserve rate; no reserve on a loss. It already includes booked
            depreciation; tax depreciation is usually larger, so reserving on book profit errs on
            the safe side. Reconciled against the actual tax return at year-end.
          </p>
        </>
      )}
    </div>
  );
}
