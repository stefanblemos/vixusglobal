"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatMoney } from "@/lib/money";
import type { ReserveEntityRow } from "@/lib/tax/reserve";
import type { EntityType } from "@/lib/tax/preview";
import { setReserveRate } from "@/lib/actions/reserve";

const TYPE_TAG: Record<EntityType, string> = {
  "C-corp": "bg-sky-50 text-sky-700",
  "Pass-through": "bg-green-50 text-green-700",
  PF: "bg-amber-50 text-amber-700",
};
const m = (n: number) => formatMoney(n, "USD");

// Reserve POR ENTIDADE — mesma base/cascata do Tax preview (fonte única), aplicando a alíquota de
// PROVISÃO. Clicar abre o "report": lucro book → ajustes → K-1 (de quem) → base → alíquota → reserva,
// e para onde a base é repassada (pass-through). C-corp reserva 21% sobre a base; PF reserva a taxa
// conservadora; pass-through repassa (0 no nível).
export function ReserveEntityTable({ rows, locked }: { rows: ReserveEntityRow[]; locked: boolean }) {
  const [selKey, setSelKey] = useState<string | null>(null);
  const sel = selKey ? (rows.find((r) => r.key === selKey) ?? null) : null;

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Entity</th>
              <th className="px-3 py-2 text-right font-medium">Taxable base</th>
              <th className="px-3 py-2 text-right font-medium">+ K-1</th>
              <th className="px-3 py-2 text-right font-medium">Rate</th>
              <th className="px-4 py-2 text-right font-medium">Reserve</th>
              <th className="px-3 py-2 font-medium">Flow</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-4 text-sm text-slate-400">
                  No entity in scope. Check companies/people in the closing and import the P&amp;L.
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.key}
                  onClick={() => setSelKey(r.key)}
                  className={`cursor-pointer hover:bg-sky-50/50 ${r.taxable < 0 ? "bg-red-50/30" : ""}`}
                  title="See the step-by-step calculation"
                >
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-800">{r.name}</div>
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${TYPE_TAG[r.entityType]}`}>{r.entityType}</span>
                    {!r.hasPnl && r.kind === "company" && <span className="ml-1 text-[10px] text-amber-600">no P&L</span>}
                    {r.inCycle && <span className="ml-1 rounded-full bg-rose-50 px-1.5 py-0.5 text-[10px] text-rose-700" title="Circular ownership — cross K-1 approximate.">⚠ cycle</span>}
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.taxable < 0 ? "text-red-600" : "text-slate-800"}`}>{m(r.taxable)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.k1In ? m(r.k1In) : "—"}</td>
                  <td className="px-3 py-2 text-right" onClick={(e) => e.stopPropagation()}>
                    {r.entityType === "Pass-through" ? (
                      <span className="text-xs text-slate-400">passes through</span>
                    ) : r.kind === "company" && !locked ? (
                      <form action={setReserveRate} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="companyId" value={r.id} />
                        <input
                          type="number"
                          name="ratePct"
                          defaultValue={r.reserveRate}
                          step="0.5"
                          min="0"
                          max="100"
                          className={`w-14 rounded border px-1.5 py-0.5 text-right text-xs ${r.hasOverride ? "border-[#1f3a5f] text-[#1f3a5f]" : "border-slate-200"}`}
                          title={r.hasOverride ? "Override for this company" : "Class rate — edit to create an override"}
                        />
                        <button className="rounded border border-slate-300 px-1.5 py-0.5 text-xs text-slate-600 hover:bg-slate-100">set</button>
                      </form>
                    ) : (
                      <span className="text-xs tabular-nums text-slate-500">{r.reserveRate}%</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {r.entityType === "Pass-through" ? <span className="text-slate-400">— (passes through)</span> : m(r.reserve)}
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
      {sel && <DetailModal row={sel} onClose={() => setSelKey(null)} onSelect={setSelKey} />}
    </>
  );
}

function Step({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5">
      <div className="text-sm text-slate-600">
        {label}
        {hint && <div className="text-[11px] text-slate-400">{hint}</div>}
      </div>
      <div className={`shrink-0 tabular-nums ${value < 0 ? "text-rose-700" : "text-slate-800"}`}>
        {value < 0 ? `(${m(Math.abs(value))})` : m(value)}
      </div>
    </div>
  );
}

function DetailModal({
  row,
  onClose,
  onSelect,
}: {
  row: ReserveEntityRow;
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

        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50/60 px-3 py-2">
          <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">Taxable base</div>
          <div className="divide-y divide-slate-100">
            <Step label={isPerson ? "Own income" : "Net income (book · P&L)"} value={row.bookNet} />
            {row.nonDeductible !== 0 && (
              <>
                <Step label="+ Non-deductible (M-1)" value={row.nonDeductible} hint="the book recorded it as an expense, but it doesn't reduce tax → they return to the base (federal tax is the biggest case)" />
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
                hint="prior year's state tax principal + penalty, paid this year (Florida control)"
              />
            )}
            {row.depAdj !== 0 ? (
              <Step label="± Actual asset depreciation" value={row.depAdj} hint="actual recorded book (reconciliation); MACRS only if there is no actual" />
            ) : (
              !isPerson && row.hasPnl && (
                <div className="py-1.5 text-[11px] text-slate-400">
                  Depreciation: trusts the book (adjustment $0).
                  {row.depCatchUp != null && Math.abs(row.depCatchUp) > 1 && (
                    <> Catch-up {m(row.depCatchUp)} is just a flag — <Link href={`/assets?tab=conferencia&company=${row.id}`} className="underline hover:text-amber-700">reconciliation</Link>.</>
                  )}
                </div>
              )
            )}
            {row.k1In !== 0 && <Step label="+ K-1 received (investees)" value={row.k1In} />}
            {row.k1From.length > 0 && (
              <div className="py-1.5 pl-3">
                <div className="text-[11px] text-slate-400">comes from:</div>
                {row.k1From.map((f) => (
                  <button key={f.fromKey} onClick={() => onSelect(f.fromKey)} className="flex w-full items-center justify-between gap-2 rounded px-1 py-0.5 text-xs hover:bg-sky-50" title="Open this investee">
                    <span className="text-sky-700 hover:underline">{f.fromName}</span>
                    <span className={`tabular-nums ${f.amount < 0 ? "text-rose-700" : "text-slate-600"}`}>{f.amount < 0 ? `(${m(Math.abs(f.amount))})` : m(f.amount)}</span>
                  </button>
                ))}
              </div>
            )}
            {row.stateEstimate > 0 && (
              <Step
                label="− Estimated state tax for the year"
                value={-(row.stateEstimate + row.stateEstInterest)}
                hint={`Florida (rate/exemption in Tax settings) = ${m(row.stateEstimate)}${row.stateEstInterest > 0 ? ` + interest ${m(row.stateEstInterest)}` : ""} — deductible, payable next year`}
              />
            )}
          </div>
          <div className="mt-1 flex items-center justify-between border-t-2 border-slate-200 pt-2">
            <span className="text-sm font-medium text-slate-700">= Taxable base</span>
            <span className={`text-base font-semibold tabular-nums ${row.taxable < 0 ? "text-rose-700" : "text-slate-900"}`}>
              {row.taxable < 0 ? `(${m(Math.abs(row.taxable))})` : m(row.taxable)}
            </span>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-lg border-2 border-[#8DC63F]/50 bg-[#8DC63F]/[0.08] px-3 py-2.5">
          <div className="text-sm text-slate-700">
            {isPass ? (
              "Pass-through — passes the base through via K-1; reserve at the owner level"
            ) : (
              <>
                Reserve <span className="font-medium">{row.reserveRate}%</span> of the base
                {row.entityType === "C-corp" ? " (C-corp, 21% federal)" : " (conservative owner reserve)"}
                {row.taxable < 0 ? " — negative base → $0" : ""}
                {row.stateReserve > 0 && (
                  <div className="mt-0.5 text-[11px] text-slate-500">
                    federal {m(row.federalReserve)} + estimated state tax {m(row.stateReserve)}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="text-lg font-semibold tabular-nums text-[#3B6D11]">{isPass ? "—" : m(row.reserve)}</div>
        </div>

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
          Cash reserve (conservative) over the SAME base as the Tax preview. C-corp 21% federal; individual
          owner at the reserve rate; pass-through passes through. Losses offset via the cascade. Reconcile
          with the return at year end.
        </p>
      </div>
    </div>
  );
}
