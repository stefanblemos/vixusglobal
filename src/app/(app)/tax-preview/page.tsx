import Link from "next/link";
import { buildTaxPreview } from "@/lib/tax/preview";
import { irTaxableConfidence } from "@/lib/tax/audit-vs-ir";
import { TaxPreviewTable } from "@/components/tax-preview-detail";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const m = (n: number) => formatMoney(n, "USD");

export default async function TaxPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const wanted = yParam && /^\d{4}$/.test(yParam) ? Number(yParam) : null;

  const probe = await buildTaxPreview(wanted ?? currentYear - 1);
  const years = probe.years.length ? probe.years : [currentYear - 1];
  const year = wanted ?? (years.includes(currentYear - 1) ? currentYear - 1 : years[0]);
  const data = wanted === year ? probe : await buildTaxPreview(year);
  // Selo de confiança da base tributável vs IR (verde confere / vermelho diverge / cinza estimado).
  const confidence = await irTaxableConfidence(
    year,
    data.rows.map((r) => ({ id: r.id, kind: r.kind, entityType: r.entityType, taxable: r.taxable, hasPnl: r.hasPnl })),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Tax preview</h1>
        <p className="text-sm text-slate-500">
          Estimated tax return per entity from QBO: net income + non-deductible expenses ± depreciation
          adjustment (book → MACRS) + K-1 received = taxable income → tax. C-corp 21%
          federal; pass-through passes through via K-1; individuals at the federal brackets (MFJ 2024, federal only).
          Control estimate — confirm with your accountant.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Year:</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/tax-preview?year=${y}`}
            className={`rounded-full px-3 py-1 ${y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {y}
          </Link>
        ))}
        <a
          href={`/api/export/tax-preview?year=${year}`}
          className="ml-auto rounded-lg border border-slate-200 px-3 py-1 text-slate-600 hover:bg-slate-50"
        >
          ↓ Export CSV
        </a>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border-2 border-[#8DC63F]/60 bg-[#8DC63F]/[0.08] p-4">
          <div className="text-xs text-slate-600">Estimated group tax return ({year})</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-[#3B6D11]">{m(data.groupTax)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">C-corp tax (21%)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{m(data.corpTax)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Individual tax (1040)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{m(data.pfTax)}</div>
        </div>
      </div>

      {data.missingPnl.length > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          No P&L for {year} imported for: {data.missingPnl.join(", ")} — these entities enter with
          $0 income. Import the P&L for the calculation to be complete.
        </p>
      )}

      {data.excludedNonUsd.length > 0 && (
        <p className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          Outside this calculation (US federal tax, USD only): {data.excludedNonUsd.join(", ")} — entities
          in foreign currency are taxed in their own country (PT/BR), not at 21% federal.
        </p>
      )}

      {data.excludedClosed.length > 0 && (
        <p className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          Closed (final tax return already filed in a prior year) — outside the calculation: {data.excludedClosed.join(", ")}.
        </p>
      )}

      <TaxPreviewTable rows={data.rows} year={year} confidence={confidence} />

      <p className="text-xs text-slate-400">
        Non-deductibles detected from the P&L: 50% of meals, fines/penalties, life insurance,
        federal tax, political/club contributions. State tax: the year&apos;s add-back comes from the
        control in <strong>Florida → Assessment</strong> (principal + penalty of what was paid in the year;
        interest is deductible for C-corp and stays out). Depreciation: the base{" "}
        <strong>trusts the book</strong> (P&L) — the depreciation already applied stays, no recalculation;
        when book and MACRS diverge, that becomes just a <strong>flag</strong> with the accumulated catch-up
        (see Review), not tax. The app&apos;s MACRS only enters the base when the book{" "}
        <strong>has no</strong> depreciation in the year (fills the gap as a deduction). K-1 passes through the taxable income
        of the pass-throughs by ownership % (ownership tree). Individuals: federal MFJ 2024 brackets
        with the standard deduction, federal only, no credits — approximate ceiling. Confirm with your accountant
        (state, credits, limits, Form 3115).
      </p>
    </div>
  );
}
