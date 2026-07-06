import { resolveWanted } from "@/lib/year";
import Link from "next/link";
import { buildTaxSimulation } from "@/lib/tax/simulator";

export const dynamic = "force-dynamic";

const M = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default async function TaxSimulatorPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: yParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const wanted = await resolveWanted(yParam);

  const probe = await buildTaxSimulation(wanted ?? currentYear - 1);
  const years = probe.years.length ? probe.years : [currentYear - 1];
  const year = wanted ?? (years.includes(currentYear - 1) ? currentYear - 1 : years[0]);
  const data = wanted === year ? probe : await buildTaxSimulation(year);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Tax analyzer — analysis</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          <strong>Legitimate</strong> scenarios ranked by the group&apos;s potential savings. Each one shows the
          math (current vs alternative) and the assumptions. <strong>Not tax advice</strong> — it&apos;s the delta under
          explicit assumptions, to take to your accountant.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Year:</span>
        {years.map((y) => (
          <Link key={y} href={`/tax-simulator?year=${y}`} className={`rounded-full px-3 py-1 ${y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{y}</Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border-2 border-[#8DC63F]/60 bg-[#8DC63F]/[0.08] p-4">
          <div className="text-xs text-slate-600">Potential savings identified ({year})</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-[#3B6D11]">{M(data.totalPotential)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Movable tax-free (already-taxed basis)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{M(data.totalTaxFree)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">Trapped in a C-corp (dividend if pulled)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-amber-700">{M(data.totalTrapped)}</div>
        </div>
      </div>

      {/* cenários de eleição S vs C */}
      <div>
        <h2 className="mb-2 text-sm font-medium text-slate-700">Scenarios (ranked by savings)</h2>
        <div className="space-y-3">
          {data.scenarios.length === 0 && <p className="text-sm text-slate-500">No relevant election scenario this year.</p>}
          {data.scenarios.map((s) => (
            <section key={s.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                <span className="font-medium text-slate-800">{s.title}</span>
                <span className={`rounded-full px-2.5 py-0.5 text-sm font-semibold tabular-nums ${s.saving > 0 ? "bg-[#8DC63F]/20 text-[#3B6D11]" : "bg-slate-100 text-slate-500"}`}>
                  {s.saving > 0 ? `savings ~${M(s.saving)}` : `no savings (C defers)`}
                </span>
              </div>
              <div className="px-4 py-3 text-sm">
                <div className="flex flex-wrap gap-x-8 gap-y-1">
                  <div><span className="text-slate-400">Current (C-corp): </span><span className="font-medium tabular-nums text-slate-800">{M(s.currentTax)}</span></div>
                  <div><span className="text-slate-400">Alternative (S): </span><span className="font-medium tabular-nums text-slate-800">{M(s.altTax)}</span></div>
                </div>
                <p className="mt-2 text-[13px] text-slate-600">{s.detail}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.assumptions.map((a, i) => (
                    <span key={i} className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{a}</span>
                  ))}
                </div>
                <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] text-amber-800">⚠ {s.caveat}</p>
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* roteamento de distribuição */}
      {data.routing.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
            Distribution routing — how to move money paying the minimum
          </div>
          <table className="w-full text-sm">
            <thead className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <tr>
                <th className="px-4 py-1.5 font-medium">Destination</th>
                <th className="px-3 py-1.5 text-right font-medium">Tax-free (already-taxed basis)</th>
                <th className="px-3 py-1.5 text-right font-medium">Trapped in a C-corp</th>
                <th className="px-3 py-1.5 text-right font-medium">Cost if pulling the trapped amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {data.routing.map((r) => (
                <tr key={r.owner}>
                  <td className="px-4 py-1.5"><span className="font-medium text-slate-800">{r.owner}</span> <span className="text-[10px] text-slate-400">{r.kind}</span></td>
                  <td className="px-3 py-1.5 text-right font-medium tabular-nums text-[#3B6D11]">{M(r.taxFree)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-amber-700">{r.trapped ? M(r.trapped) : "—"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-rose-600">{r.trappedCost ? `~${M(r.trappedCost)}` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-[11px] text-slate-400">
            Prioritize distributing what is <strong>tax-free</strong> (return of already-taxed basis) before pulling
            what is trapped in the C-corp (dividend ~{20}%). See <Link href="/distributable" className="text-sky-700 underline">Distributable basis</Link> for the step-by-step by source.
          </p>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Control estimates under explicit assumptions — <strong>they do not replace your accountant</strong>. Election
        eligibility, timing, state and non-tax effects need professional analysis. The goal is to point out
        where the conversation is worth having, not to decide for you.
      </p>
    </div>
  );
}
