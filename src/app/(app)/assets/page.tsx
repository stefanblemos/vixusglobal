import Link from "next/link";
import { buildAssetRegister } from "@/lib/assets/depreciation";
import { buildDepreciationVsIR } from "@/lib/assets/dep-vs-ir";
import { AssetCreateForm } from "@/components/asset-create-form";
import { deleteAsset } from "@/lib/actions/assets";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; company?: string }>;
}) {
  const { year: yearParam, company } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : currentYear;

  const [reg, vsIr] = await Promise.all([
    buildAssetRegister(year, company),
    buildDepreciationVsIR(year),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Fixed assets &amp; depreciation</h1>
        <p className="text-sm text-slate-500">
          MACRS depreciation per asset (US) from the acquisition date — with §179 and bonus. The
          computed accumulated depreciation is the basis to compare against the tax return.
        </p>
      </div>

      <AssetCreateForm companies={reg.companies} />

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Year:</span>
        {vsIr.years.map((y) => (
          <Link
            key={y}
            href={`/assets?year=${y}${company ? `&company=${company}` : ""}`}
            className={`rounded-full px-3 py-1 ${
              y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {y}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Stat label={`Depreciation ${year}`} value={formatMoney(reg.totalYearDep, "USD")} />
        <Stat label="Assets" value={String(reg.assets.length)} />
        <Stat
          label="Companies with assets"
          value={String(reg.byCompany.length)}
        />
      </div>

      {reg.byCompany.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 text-right font-medium">Depreciation {year}</th>
                <th className="px-4 py-2 text-right font-medium">Accumulated thru {year}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {reg.byCompany.map((c) => (
                <tr key={c.companyId}>
                  <td className="px-4 py-2 font-medium text-slate-700">{c.companyName}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                    {formatMoney(c.yearDep, "USD")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {formatMoney(c.accumulated, "USD")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {vsIr.rows.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium text-slate-800">Computed vs tax return — {year}</h2>
          <p className="text-sm text-slate-500">
            The computed MACRS depreciation against the depreciation reported on the income tax
            return (Form 4562 line on the 1120/1065). A gap means the assets on file and the return
            don&rsquo;t agree — investigate before relying on either.
          </p>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Company</th>
                  <th className="px-3 py-2 text-right font-medium">Computed (MACRS)</th>
                  <th className="px-3 py-2 text-right font-medium">IR reported</th>
                  <th className="px-3 py-2 text-right font-medium">Difference</th>
                  <th className="px-3 py-2 text-center font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {vsIr.rows.map((r) => (
                  <tr key={r.companyId} className={r.reported != null && !r.ok ? "bg-rose-50/40" : ""}>
                    <td className="px-4 py-2">
                      <Link href={`/companies/${r.companyId}`} className="font-medium text-[#1f3a5f] hover:underline">
                        {r.name}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {formatMoney(r.computed, "USD")}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {r.reported == null ? (
                        <span className="text-xs text-amber-600">no IR figure</span>
                      ) : (
                        formatMoney(r.reported, "USD")
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 text-right tabular-nums ${
                        r.diff == null ? "text-slate-300" : r.ok ? "text-slate-400" : "font-medium text-rose-600"
                      }`}
                    >
                      {r.diff == null ? "—" : formatMoney(r.diff, "USD")}
                    </td>
                    <td className="px-3 py-2 text-center">
                      {r.reported == null ? (
                        <span className="text-slate-300">—</span>
                      ) : r.ok ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-rose-500">✗</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-slate-400">
            ✓ within 1% or $1. &ldquo;No IR figure&rdquo; = no return on file for {year}, or the
            return had no depreciation line extracted. The IR figure is the year&rsquo;s deduction;
            accumulated computed is in the table above.
          </p>
        </section>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Asset</th>
              <th className="px-3 py-2 font-medium">Company</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Acquired</th>
              <th className="px-3 py-2 text-right font-medium">Cost</th>
              <th className="px-3 py-2 text-right font-medium">§179 / bonus</th>
              <th className="px-3 py-2 text-right font-medium">Dep {year}</th>
              <th className="px-3 py-2 text-right font-medium">Accum.</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {reg.assets.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-4 text-sm text-slate-400">
                  No assets yet. Add one above.
                </td>
              </tr>
            ) : (
              reg.assets.map((a) => (
                <tr key={a.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 font-medium text-slate-700">{a.name}</td>
                  <td className="px-3 py-2 text-slate-600">{a.companyName}</td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {a.categoryLabel}
                    <span className="text-slate-400"> · {a.recoveryYears}yr</span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{a.acquisitionDate}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                    {formatMoney(a.cost, "USD")}
                  </td>
                  <td className="px-3 py-2 text-right text-xs text-slate-500">
                    {a.section179 > 0 ? formatMoney(a.section179, "USD") : "—"}
                    {a.bonusPct > 0 ? ` / ${a.bonusPct}%` : ""}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">
                    {formatMoney(a.yearDep, "USD")}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {formatMoney(a.accumulated, "USD")}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <form action={deleteAsset}>
                      <input type="hidden" name="id" value={a.id} />
                      <button className="text-xs text-slate-300 hover:text-red-600" title="Delete">
                        ✕
                      </button>
                    </form>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        MACRS GDS half-year tables (Pub. 946); real property is straight-line mid-month. §179 and
        bonus are taken in year 1, then MACRS on the remaining basis. A control estimate — confirm
        conventions (mid-quarter, luxury-auto caps) with the accountant.
      </p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-800">{value}</div>
    </div>
  );
}
