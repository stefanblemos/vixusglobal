"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { TaxPreviewRow, EntityType } from "@/lib/tax/preview";

const TYPE_TAG: Record<EntityType, string> = {
  "C-corp": "bg-sky-50 text-sky-700",
  "Pass-through": "bg-green-50 text-green-700",
  PF: "bg-amber-50 text-amber-700",
};
const m = (n: number) => formatMoney(n, "USD");

// Tabela do tax preview com drill-down: clicar numa entidade abre o "report" do cálculo passo a
// passo (lucro book → ajustes → base → imposto) e o fluxo K-1 (de quais investidas vem, para quais
// owners vai). Origem e destino do K-1 permitem rastrear das formadoras até os donos.
// Selo de confiança da base tributável vs IR (vem da página, calculado em irTaxableConfidence).
const CONF: Record<string, { label: string; cls: string; title: string }> = {
  match: { label: "✓ return", cls: "bg-[#8DC63F]/20 text-[#3B6D11]", title: "Taxable income matches the filed return" },
  diverge: { label: "≠ return", cls: "bg-rose-100 text-rose-700", title: "Taxable income diverges from the return — see Return check" },
  none: { label: "est.", cls: "bg-slate-100 text-slate-500", title: "No return for the year to check against — estimate only" },
};

export function TaxPreviewTable({
  rows,
  year,
  confidence = {},
}: {
  rows: TaxPreviewRow[];
  year: number;
  confidence?: Record<string, "match" | "diverge" | "none">;
}) {
  const [selKey, setSelKey] = useState<string | null>(null);
  const sel = selKey ? (rows.find((r) => r.key === selKey) ?? null) : null;

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Entity</th>
              <th className="px-3 py-2 text-right font-medium">Net income</th>
              <th className="px-3 py-2 text-right font-medium">+ Non-ded.</th>
              <th className="px-3 py-2 text-right font-medium">± Deprec.</th>
              <th className="px-3 py-2 text-right font-medium">+ K-1</th>
              <th className="px-3 py-2 text-right font-medium">= Taxable inc.</th>
              <th className="px-3 py-2 text-right font-medium">Estimated tax</th>
              <th className="px-3 py-2 font-medium">Flow</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-4 text-sm text-slate-400">
                  No entity in scope. Check the companies/people flagged in the close.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.key}
                  onClick={() => setSelKey(r.key)}
                  className={`cursor-pointer hover:bg-sky-50/50 ${r.taxable < 0 ? "bg-red-50/30" : ""}`}
                  title="View the step-by-step calculation"
                >
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-800">{r.name}</div>
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${TYPE_TAG[r.entityType]}`}>{r.entityType}</span>
                    {confidence[r.id] && (
                      <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[10px] ${CONF[confidence[r.id]].cls}`} title={CONF[confidence[r.id]].title}>
                        {CONF[confidence[r.id]].label}
                      </span>
                    )}
                    {!r.hasPnl && r.kind === "company" && !r.disregardedInto && <span className="ml-1 text-[10px] text-amber-600">no P&L</span>}
                    {r.disregardedInto && (
                      <span className="ml-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700" title={`Disregarded entity — no separate return; result folded into ${r.disregardedInto}`}>
                        → {r.disregardedInto} · disregarded
                      </span>
                    )}
                    {r.foldedIn.length > 0 && (
                      <span className="ml-1 rounded-full bg-violet-50 px-1.5 py-0.5 text-[10px] text-violet-700" title={`Consolidates disregarded entities: ${r.foldedIn.map((f) => `${f.name} (${m(f.book)})`).join(", ")}`}>
                        + {r.foldedIn.map((f) => f.acronym).join(", ")} folded in
                      </span>
                    )}
                    {r.inCycle && (
                      <span className="ml-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700" title="Circular ownership — cross K-1 approximated.">
                        ⚠ cycle
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.kind === "person" ? "—" : m(r.bookNet)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                    {r.nonDeductible + r.stateTaxAddBack ? m(r.nonDeductible + r.stateTaxAddBack) : "—"}
                    {r.stateTaxAddBack > 0 && (
                      <div className="text-[10px] text-sky-700">includes state tax {m(r.stateTaxAddBack)}</div>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.depAdj < 0 ? "text-emerald-600" : "text-slate-600"}`}>
                    {r.macrsApplied ? m(r.depAdj) : "—"}
                    {r.kind === "company" && r.hasPnl && r.macrsApplied && (
                      <div className="text-[10px] text-emerald-700">deprec. applied</div>
                    )}
                    {r.kind === "company" && r.hasPnl && !r.macrsApplied && r.depCatchUp != null && Math.abs(r.depCatchUp) > 1 && (
                      <div className="text-[10px] text-amber-600">catch-up {m(r.depCatchUp)}</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.k1In ? m(r.k1In) : "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.taxable < 0 ? "text-red-600" : "text-slate-800"}`}>{m(r.taxable)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.entityType === "Pass-through" ? (
                      <span className="text-slate-400">— (passes through)</span>
                    ) : (
                      <span className="font-semibold text-slate-900">{m(r.tax)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {r.entityType === "Pass-through"
                      ? r.passesTo.length
                        ? `passes to: ${r.passesTo.map((p) => `${p.acronym} ${p.pct.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`).join(" · ")}`
                        : "passes to the owners"
                      : r.entityType === "PF"
                        ? "final payer (1040)"
                        : "pays 21%"}
                  </td>
                  <td className="px-2 py-2 text-right text-slate-300">›</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {sel && <DetailModal row={sel} year={year} onClose={() => setSelKey(null)} onSelect={setSelKey} />}
    </>
  );
}

// Linha da cascata da base.
function Step({ label, value, hint, muted }: { label: string; value: number; hint?: string; muted?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="text-sm text-slate-600">
        {label}
        {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
      </div>
      <div className={`shrink-0 tabular-nums ${muted ? "text-slate-400" : value < 0 ? "text-rose-700" : "text-slate-800"}`}>
        {value < 0 ? `(${m(Math.abs(value))})` : m(value)}
      </div>
    </div>
  );
}

function DetailModal({
  row,
  year,
  onClose,
  onSelect,
}: {
  row: TaxPreviewRow;
  year: number;
  onClose: () => void;
  onSelect: (key: string) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const isPerson = row.kind === "person";
  const isPass = row.entityType === "Pass-through";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center" onClick={onClose}>
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-base font-semibold text-slate-800">{row.name}</div>
            <div className="mt-0.5 flex items-center gap-1.5">
              <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${TYPE_TAG[row.entityType]}`}>{row.entityType}</span>
              {!row.hasPnl && !isPerson && <span className="text-[10px] text-amber-600">no P&L for the year (base $0 + K-1)</span>}
              {row.inCycle && <span className="rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700">⚠ cycle</span>}
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">✕</button>
        </div>

        {row.kind === "company" && (
          <div className="mt-2 flex items-center gap-3 text-xs">
            <span className="text-slate-400">Check in QBO:</span>
            {row.pnlImportId ? (
              <Link href={`/import/${row.pnlImportId}`} className="text-sky-700 hover:underline">P&amp;L for the year →</Link>
            ) : (
              <span className="text-amber-600">P&amp;L not imported</span>
            )}
            {row.bsImportId ? (
              <Link href={`/import/${row.bsImportId}`} className="text-sky-700 hover:underline">Balance Sheet →</Link>
            ) : (
              <span className="text-amber-600">BS not imported</span>
            )}
          </div>
        )}

        {/* Cascata da base */}
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Taxable income ({year})</div>
          <div className="divide-y divide-slate-100">
            <Step label={isPerson ? "Own income" : "Net income (book · P&L)"} value={row.bookNet} muted={isPerson && row.bookNet === 0} />
            {row.nonDeductible !== 0 && (
              <>
                <Step label="+ Non-deductible (Schedule M-1)" value={row.nonDeductible} hint="the book recorded it as an expense, but it does not reduce tax → they add back to the base (federal tax is the biggest case)" />
                {row.nonDeductibleItems.length > 0 && (
                  <div className="py-1 pl-3">
                    {row.nonDeductibleItems.map((it, i) => (
                      <div key={i} className="flex items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span className="truncate">{it.label}</span>
                        <span className="shrink-0 tabular-nums">{m(it.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
            {row.stateTaxAddBack !== 0 && (
              <Step
                label="+ State tax paid in the year (add-back)"
                value={row.stateTaxAddBack}
                hint={`principal + penalty of the ${year - 1} state tax paid in ${year} (Florida control) — already deducted on an accrual basis${row.stateTaxInterest > 0 ? ` · interest ${m(row.stateTaxInterest)} is deductible (left out)` : ""}`}
              />
            )}
            {row.statePnlUnfiled > 0 && (
              <div className="my-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-[11px] text-amber-800">
                ⚠ The P&L has <strong>{m(row.statePnlUnfiled)}</strong> in &ldquo;State Taxes&rdquo; not registered in{" "}
                <Link href="/florida" className="underline hover:text-amber-900">Florida</Link>. It was not added to the base
                (the principal/penalty/interest split comes from the DOR receipt, and the line mixes years — we do not guess). Register the
                StateTaxFiling so the add-back comes in correctly.
              </div>
            )}
            {row.depAdj !== 0 ? (
              <Step label="± Depreciation adjustment" value={row.depAdj} hint="the P&L had no depreciation for the year → applies the REAL depreciation of the assets (recorded in the check; MACRS only if there is no real)" />
            ) : (
              !isPerson && row.hasPnl && (
                <div className="py-1.5 text-[11px] text-slate-400">
                  Depreciation: trusts the book (adjustment $0).
                  {row.bookDep > 0 && <> Book {m(row.bookDep)} · MACRS {m(row.macrsDep)}.</>}
                  {row.depCatchUp != null && Math.abs(row.depCatchUp) > 1 && (
                    <>
                      {" "}Catch-up of {m(row.depCatchUp)} is only a flag (does not enter the tax) —{" "}
                      <Link href={`/assets?tab=conferencia&company=${row.id}`} className="underline hover:text-amber-700">view Check</Link>.
                    </>
                  )}
                </div>
              )
            )}
            {row.k1In !== 0 && <Step label="+ K-1 received (investees)" value={row.k1In} />}
            {/* origem do K-1 */}
            {row.k1From.length > 0 && (
              <div className="py-1.5 pl-3">
                <div className="text-[11px] text-slate-400">comes from:</div>
                {row.k1From.map((f) => (
                  <button
                    key={f.fromKey}
                    onClick={() => onSelect(f.fromKey)}
                    className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-sky-50"
                    title="Open the calculation for this investee"
                  >
                    <span className="text-sky-700 hover:underline">{f.fromName}</span>
                    <span className={`tabular-nums ${f.amount < 0 ? "text-rose-700" : "text-slate-600"}`}>
                      {f.amount < 0 ? `(${m(Math.abs(f.amount))})` : m(f.amount)}
                    </span>
                  </button>
                ))}
              </div>
            )}
            {row.stateEstimate > 0 && (
              <Step
                label={`− Estimated ${year} state tax (payable in ${year + 1})`}
                value={-(row.stateEstimate + row.stateEstInterest)}
                hint={`Florida (year rate/exemption in Tax settings) = ${m(row.stateEstimate)}${row.stateEstInterest > 0 ? ` + estimated interest ${m(row.stateEstInterest)} (~8%/yr, paid in ${year + 1})` : ""} — deductible on the federal`}
              />
            )}
          </div>
          <div className="mt-1 flex items-center justify-between border-t-2 border-slate-200 pt-2">
            <span className="text-sm font-medium text-slate-700">= Taxable income</span>
            <span className={`text-base font-semibold tabular-nums ${row.taxable < 0 ? "text-rose-700" : "text-slate-900"}`}>
              {row.taxable < 0 ? `(${m(Math.abs(row.taxable))})` : m(row.taxable)}
            </span>
          </div>
        </div>

        {/* Imposto */}
        <div className="mt-3 flex items-center justify-between rounded-lg border-2 border-[#8DC63F]/50 bg-[#8DC63F]/[0.08] px-3 py-2.5">
          <div className="text-sm text-slate-700">
            {isPass ? (
              "Pass-through — does not pay at this level; passes the base along via K-1"
            ) : row.entityType === "C-corp" ? (
              <>C-corp — 21% × base{row.taxable < 0 ? " (loss → $0; no NOL carry-forward here)" : ""}</>
            ) : (
              "PF — 2024 MFJ federal brackets, standard deduction (federal only, no credits)"
            )}
          </div>
          <div className="text-lg font-semibold tabular-nums text-[#3B6D11]">{isPass ? "—" : m(row.tax)}</div>
        </div>

        {/* Fluxo para os owners (pass-through) */}
        {isPass && (
          <div className="mt-3">
            <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Passes the base to</div>
            {row.passesTo.length === 0 ? (
              <p className="text-xs text-slate-400">Owners not registered — register the ownership to see the flow.</p>
            ) : (
              <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
                {row.passesTo.map((p) => (
                  <div key={p.acronym + p.pct} className="flex items-center justify-between gap-2 px-3 py-1.5 text-sm">
                    <span className="text-slate-700">{p.name}</span>
                    <span className="flex items-center gap-3 tabular-nums">
                      <span className="text-xs text-slate-400">{p.pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%</span>
                      <span className={row.taxable < 0 ? "text-rose-700" : "text-slate-800"}>
                        {(() => { const a = Math.round((row.taxable * p.pct) / 100 * 100) / 100; return a < 0 ? `(${m(Math.abs(a))})` : m(a); })()}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        <p className="mt-3 text-[11px] text-slate-400">
          Control estimate. Trust the book for depreciation (the divergence vs MACRS is a flag, not
          tax); a C-corp loss does not carry NOL here; PF brackets are 2024 MFJ. Confirm with your accountant.
        </p>
      </div>
    </div>
  );
}
