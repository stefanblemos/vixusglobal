import Link from "next/link";
import { buildDistributableReport } from "@/lib/tax/distributable";
import { reserveYears } from "@/lib/tax/reserve";
import { YearSelect } from "@/components/year-select";
import { DistributableReport } from "@/components/distributable-report";

export const dynamic = "force-dynamic";

export default async function DistributablePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearRaw } = await searchParams;
  const years = await reserveYears();
  const fallback = years[0] ?? new Date().getFullYear();
  const year = yearRaw && years.includes(Number(yearRaw)) ? Number(yearRaw) : fallback;
  const report = await buildDistributableReport(year);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Distributable basis — already-taxed income</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            How much can be moved from each pass-through to the <strong>final destination</strong> (person or
            C-corp) <strong>without paying tax again</strong> — the income was already taxed on the K-1. The basis
            is the <strong>capital account (end)</strong> of the latest tax return (source: the return, not the books).
            <strong>Gross</strong> value: distributing up to the basis is a return of already-taxed income
            (tax-free); above it becomes a capital gain.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {years.length > 0 && <YearSelect years={years} value={year} basePath="/distributable" />}
          <a
            href={`/api/export/distributable?year=${year}`}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            ↓ Export CSV
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-600">
        <div className="font-medium text-slate-700">Accounting entry for the transfer</div>
        <ul className="mt-1 space-y-0.5">
          <li>
            <strong>Source</strong> (the pass-through): <span className="font-mono">D Distributions / Owner&apos;s equity</span> ·{" "}
            <span className="font-mono">C Cash</span> — reduces the capital account (not an expense).
          </li>
          <li>
            <strong>C-corp destination</strong> (QBO): <span className="font-mono">D Cash</span> ·{" "}
            <span className="font-mono">C Investment in [source]</span> — return of capital (not revenue).
          </li>
          <li>
            <strong>Person destination</strong>: distribution to the owner — for an individual it is a return of basis, not income.
          </li>
        </ul>
      </div>

      {report.owners.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Nothing to distribute based on the {year} tax return. See below what is missing.
        </div>
      ) : (
        <DistributableReport owners={report.owners} />
      )}

      {report.missing.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <div className="font-medium">⚠ Pass-throughs not calculated — missing tax return data (not guessed, to avoid errors)</div>
          <ul className="mt-1 space-y-0.5">
            {report.missing.map((m) => (
              <li key={m.companyId}>
                <Link href={`/companies/${m.companyId}`} className="underline hover:text-amber-900">{m.name}</Link> —{" "}
                {m.reason === "sem-ir" ? (
                  <span>no return through {year} in the app — <Link href="/tax" className="underline">upload the return</Link></span>
                ) : (
                  <span>return present, but no &ldquo;capital account (end)&rdquo; figure — check/re-extract the return</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Basis = capital account (end) of the return = contribution + already-taxed income − distributions. Cap: above the
        basis, the excess becomes a capital gain. Chain: pass-through → owner; C-corp and person are the final
        destination (the basis of a pass-through&apos;s investees is already in its capital account — no double
        counting). Confirm with your accountant before distributing.
      </p>
    </div>
  );
}
