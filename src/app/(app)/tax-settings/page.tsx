import Link from "next/link";
import { yearRates, reserveScopeYears } from "@/lib/tax/reserve";
import { setTaxRateYear } from "@/lib/actions/reserve";

export const dynamic = "force-dynamic";

export default async function TaxSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearRaw } = await searchParams;
  const years = reserveScopeYears();
  const year = yearRaw && years.includes(Number(yearRaw)) ? Number(yearRaw) : years[0];
  const rates = await yearRates(year);

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Tax settings</h1>
        <p className="text-sm text-slate-500">
          Provision rates used across the tax reserve and Florida forecast. C-corps use the federal
          corporate rate; pass-through entities and individuals use a blended provision rate. Set per
          year — adjust as the law changes. Per-company overrides still apply on top.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Year:</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/tax-settings?year=${y}`}
            className={`rounded-full px-3 py-1 ${
              y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {y}
          </Link>
        ))}
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
        These rates only cover the current and prior year — older years are archived. The rate
        applied to each company is chosen by its tax treatment (C-corp → corporate rate, otherwise →
        pass-through), unless a per-company override is set on the reserve&apos;s Annual tab.
      </p>
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
