"use client";

import { Fragment, useState } from "react";
import { useFormStatus } from "react-dom";
import { formatMoney } from "@/lib/money";
import type { ReconYearRow, ReconStatus } from "@/lib/assets/reconcile-dep";
import { setAssetYearDepreciation, distributeYearDepreciation } from "@/lib/actions/assets";

export type AssetForRecon = {
  id: string;
  name: string;
  cost: number;
  disposalYear: number | null; // ano da baixa (vendido/baixado) — não deprecia depois
  macrsSchedule: { year: number; amount: number }[]; // MACRS PURA (deveria) — regra legal do IRS
  actualByYear: Record<string, number>; // ano → depreciação real registrada à mão (sobrescreve)
  derivedByYear: Record<string, number>; // ano → depreciação do livro DERIVADA (totalmente dep./baixa)
};

const STATUS: Record<ReconStatus, { label: string; cls: string }> = {
  ok: { label: "ok", cls: "bg-green-50 text-green-700" },
  faltou: { label: "not reported", cls: "bg-red-50 text-red-700" },
  diferente: { label: "diverges", cls: "bg-amber-50 text-amber-700" },
  "sem-ir": { label: "no return", cls: "bg-slate-100 text-slate-500" },
  na: { label: "—", cls: "text-slate-300" },
};

const m = (n: number) => formatMoney(n, "USD");
const m0 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.round(n));

export function DepReconcileTable({
  rows,
  throughYear,
  assets,
}: {
  rows: ReconYearRow[];
  throughYear: number;
  assets: AssetForRecon[];
}) {
  const [openYear, setOpenYear] = useState<number | null>(null);

  return (
    <>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Year</th>
              <th className="px-3 py-2 text-right font-medium">MACRS (year)</th>
              <th className="px-3 py-2 text-right font-medium">MACRS accumulated</th>
              <th className="px-3 py-2 text-right font-medium">Tax return (year)</th>
              <th className="px-3 py-2 text-right font-medium">Tax return accum.</th>
              <th className="px-3 py-2 text-right font-medium">Accum. difference</th>
              <th className="px-3 py-2 text-center font-medium">Status</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r, i) => {
              const st = STATUS[r.status];
              const future = r.year > throughYear;
              // 1ª linha após o último ano declarado → divisor "projeção".
              const showDivider = r.beyondFiled && !(rows[i - 1]?.beyondFiled ?? false);
              return (
                <Fragment key={r.year}>
                  {showDivider && (
                    <tr className="bg-slate-50/70">
                      <td colSpan={8} className="px-4 py-1.5 text-[11px] font-medium text-slate-400">
                        Projection — years not yet filed (normal depreciation to report; not arrears)
                      </td>
                    </tr>
                  )}
                  <tr
                    onClick={() => setOpenYear(r.year)}
                    className={`cursor-pointer hover:bg-sky-50/60 ${r.status === "faltou" ? "bg-red-50/40" : r.beyondFiled ? "text-slate-400" : ""}`}
                    title="Click to view and record depreciation per asset for this year"
                  >
                    <td className="px-4 py-2 font-medium">{r.year}{future ? " (proj.)" : ""}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.macrs ? m(r.macrs) : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{m(r.macrsAccum)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{r.ir == null ? "—" : m(r.ir)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-500">{r.beyondFiled ? "—" : m(r.irAccum)}</td>
                    {r.beyondFiled ? (
                      <td className="px-3 py-2 text-right text-[11px] text-slate-300" title="Years not yet filed: MACRS is only a projection; the catch-up counts only up to the last tax return.">
                        to report
                      </td>
                    ) : (
                      <td className={`px-3 py-2 text-right tabular-nums ${Math.abs(r.accumDiff) <= 1 ? "text-slate-400" : r.accumDiff < 0 ? "font-medium text-rose-700" : "font-medium text-amber-700"}`}>
                        {m(r.accumDiff)}
                      </td>
                    )}
                    <td className="px-3 py-2 text-center">
                      <span className={`rounded-full px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
                    </td>
                    <td className="px-2 py-2 text-right text-slate-300">›</td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        <strong>Accum. difference</strong> = accumulated MACRS − accumulated tax return, only up to the
        last <strong>filed</strong> year (it&apos;s the real catch-up). After that the tax return
        hasn&apos;t been filed yet, so the difference becomes <strong>&ldquo;to report&rdquo;</strong>{" "}
        (normal depreciation, not arrears). Click a row to view and{" "}
        <strong>record the actual depreciation per asset</strong> for that year. Confirm with your
        accountant before deducting it all at once (there may be a proper way to recover omitted
        depreciation, e.g. Form 3115).
      </p>

      {openYear != null && (
        <YearModal
          year={openYear}
          assets={assets}
          irForYear={rows.find((r) => r.year === openYear)?.ir ?? null}
          macrsForYear={rows.find((r) => r.year === openYear)?.macrs ?? 0}
          onClose={() => setOpenYear(null)}
        />
      )}
    </>
  );
}

function YearModal({
  year,
  assets,
  irForYear,
  macrsForYear,
  onClose,
}: {
  year: number;
  assets: AssetForRecon[];
  irForYear: number | null;
  macrsForYear: number;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [view, setView] = useState<"ano" | "acum">("ano"); // por ano × acumulado (catch-up)
  const r2 = (n: number) => Math.round(n * 100) / 100;

  // Só ativos já em serviço no ano (entrada ≤ ano).
  // Depreciado por ano = manual (sobrescreve) ?? derivado dos sinais cadastrados (totalmente dep./baixa).
  const bookOf = (a: AssetForRecon, y: number): number | undefined =>
    a.actualByYear[String(y)] ?? a.derivedByYear[String(y)];
  const rowsForYear = assets
    .map((a) => {
      const acqYear = a.macrsSchedule.length ? a.macrsSchedule[0].year : year;
      const deveria = a.macrsSchedule.find((s) => s.year === year)?.amount ?? 0;
      const manual = a.actualByYear[String(year)];
      const depreciado = bookOf(a, year);
      const isDerived = manual == null && depreciado != null;
      // Acumulado do livro: até o ano (accReal) e ANTES do ano (accBefore, p/ saber se já zerou).
      const years = new Set([...Object.keys(a.actualByYear), ...Object.keys(a.derivedByYear)]);
      let accReal = 0;
      let accBefore = 0;
      for (const k of years) {
        const v = bookOf(a, Number(k)) ?? 0;
        if (Number(k) <= year) accReal += v;
        if (Number(k) < year) accBefore += v;
      }
      const saldoReal = Math.max(0, a.cost - accReal);
      // Acumulados (até o ano): MACRS que DEVERIA × o que foi de fato lançado → catch-up por ativo.
      const macrsAccum = r2(a.macrsSchedule.reduce((s, x) => (x.year <= year ? s + x.amount : s), 0));
      const bookAccum = r2(accReal);
      const catchUp = r2(macrsAccum - bookAccum);
      return { a, acqYear, deveria, depreciado, isDerived, saldoReal, accBefore, macrsAccum, bookAccum, catchUp };
    })
    // Em serviço no ano: já adquirido, NÃO baixado em ano anterior (depois da baixa não deprecia
    // mais → sai do modal), e ainda não totalmente zerado no livro antes deste ano.
    .filter(
      (r) =>
        r.acqYear <= year &&
        (r.a.disposalYear == null || r.a.disposalYear >= year) &&
        r.accBefore < r.a.cost - 0.005,
    )
    .sort((x, y2) => y2.deveria - x.deveria);

  const totDeveria = rowsForYear.reduce((s, r) => s + r.deveria, 0);
  const totDepreciado = rowsForYear.reduce((s, r) => s + (r.depreciado ?? 0), 0);
  const registrados = rowsForYear.filter((r) => r.depreciado != null).length;
  // Totais acumulados (visão "Acumulado").
  const totMacrsAccum = r2(rowsForYear.reduce((s, r) => s + r.macrsAccum, 0));
  const totBookAccum = r2(rowsForYear.reduce((s, r) => s + r.bookAccum, 0));
  const totCatchUp = r2(totMacrsAccum - totBookAccum);
  // Match livro × IR declarado: a soma do que foi alocado por ativo deve bater com o que o contador
  // declarou no ano (mesmo que NÃO bata com a MACRS). Diferença = quanto ainda falta alocar/conciliar.
  const matchDiff = irForYear == null ? null : Math.round((irForYear - totDepreciado) * 100) / 100;
  const matched = matchDiff != null && Math.abs(matchDiff) <= 1;

  // Distribuir saldo: rateia o que falta alocar entre os ativos AINDA sem valor, proporcional à
  // MACRS (Deveria) deles. O último recebe o resto, para fechar exatamente no saldo.
  const remaining = matchDiff ?? 0;
  const candidates = rowsForYear.filter((r) => r.depreciado == null && r.deveria > 0.005);
  const sumCandDeveria = candidates.reduce((s, r) => s + r.deveria, 0);
  const canDistribute = remaining > 0.5 && candidates.length > 0 && sumCandDeveria > 0.005;
  const allocations = canDistribute
    ? (() => {
        let acc = 0;
        return candidates.map((r, i) => {
          const amount =
            i === candidates.length - 1
              ? Math.round((remaining - acc) * 100) / 100
              : Math.round(((remaining * r.deveria) / sumCandDeveria) * 100) / 100;
          acc += amount;
          return { assetId: r.a.id, amount };
        });
      })()
    : [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center" onClick={onClose}>
      <div className="flex max-h-[88vh] w-full max-w-4xl flex-col rounded-xl border border-slate-200 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-base font-medium text-slate-800">Depreciation per asset — {year}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              What MACRS says <strong>should</strong> have been depreciated × what was actually reported
              in the book. Edit with the pencil to record the actual value per asset. Under{" "}
              <strong>Accumulated</strong>, see the total that should be vs the actual and the{" "}
              <strong>catch-up</strong> per asset — positive = still to report; negative = already{" "}
              <strong>over-depreciated</strong> (careful, nothing to report).
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            ✕
          </button>
        </div>

        {/* Toggle por ano × acumulado + referência */}
        <div className="my-3 flex shrink-0 flex-wrap items-center gap-2 text-xs">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
            <button onClick={() => setView("ano")} className={`px-3 py-1.5 ${view === "ano" ? "bg-[#1f3a5f] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              By year
            </button>
            <button onClick={() => setView("acum")} className={`px-3 py-1.5 ${view === "acum" ? "bg-[#1f3a5f] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              Accumulated
            </button>
          </div>
          {view === "ano" ? (
            <>
              <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-600">
                MACRS for the year (should): <span className="font-semibold tabular-nums text-slate-800">{m(macrsForYear)}</span>
              </span>
              <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-600">
                Reported on the return for the year:{" "}
                <span className="font-semibold tabular-nums text-slate-800">{irForYear == null ? "—" : m(irForYear)}</span>
              </span>
              <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-600">
                Recorded per asset: <span className="font-semibold tabular-nums text-slate-800">{m(totDepreciado)}</span>{" "}
                ({registrados}/{rowsForYear.length})
              </span>
            </>
          ) : (
            <>
              <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-600">
                MACRS accum. (should) thru {year}: <span className="font-semibold tabular-nums text-slate-800">{m(totMacrsAccum)}</span>
              </span>
              <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-600">
                Depreciated accum. (book): <span className="font-semibold tabular-nums text-slate-800">{m(totBookAccum)}</span>
              </span>
              {Math.abs(totCatchUp) <= 1 ? (
                <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-700">
                  Reconciled: nothing to report
                </span>
              ) : totCatchUp > 0 ? (
                <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-700">
                  Catch-up to report: <span className="font-semibold tabular-nums">{m(totCatchUp)}</span>
                </span>
              ) : (
                <span className="rounded-lg bg-rose-50 px-3 py-1.5 text-rose-700">
                  ⚠ Over-depreciated: <span className="font-semibold tabular-nums">{m(Math.abs(totCatchUp))}</span> — nothing to report
                </span>
              )}
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 bg-slate-50 text-left text-slate-500 shadow-[0_1px_0_0_rgb(226,232,240)]">
              <tr>
                <th className="px-3 py-2 font-medium">Asset</th>
                <th className="px-3 py-2 text-right font-medium">Original cost</th>
                <th className="px-3 py-2 text-right font-medium">{view === "ano" ? "Should (MACRS)" : "MACRS accum. (should)"}</th>
                <th className="px-3 py-2 text-right font-medium">{view === "ano" ? "Depreciated (book)" : "Depreciated accum. (book)"}</th>
                <th className="px-3 py-2 text-right font-medium">{view === "ano" ? "Difference" : "Catch-up"}</th>
                <th className="px-3 py-2 text-right font-medium">Actual balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rowsForYear.map(({ a, deveria, depreciado, isDerived, saldoReal, macrsAccum, bookAccum, catchUp }) => {
                const diff = depreciado == null ? null : Math.round((deveria - depreciado) * 100) / 100;
                const disposedHere = a.disposalYear === year; // baixado neste ano
                // Deveria depreciar (deveria > 0) mas o livro lançou ZERO → não foi depreciado.
                const notDepreciated = view === "ano" && depreciado != null && depreciado <= 0.005 && deveria > 0.5;
                return (
                  <tr key={a.id} className={notDepreciated ? "bg-rose-50/40" : ""}>
                    <td className="px-3 py-2 font-medium text-slate-700">
                      {a.name}
                      {disposedHere && (
                        <span className="ml-1.5 rounded-full bg-amber-50 px-1.5 py-0.5 text-[10px] text-amber-700">disposed {year}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{m0(a.cost)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-slate-700">
                      {view === "ano" ? (deveria ? m(deveria) : "—") : macrsAccum ? m(macrsAccum) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {view === "acum" ? (
                        <span className={`tabular-nums ${bookAccum > 0.005 ? "text-slate-800" : "text-slate-300"}`}>
                          {bookAccum > 0.005 ? m(bookAccum) : "—"}
                        </span>
                      ) : editing === a.id ? (
                        <form
                          action={setAssetYearDepreciation}
                          onSubmit={() => setTimeout(() => setEditing(null), 50)}
                          className="flex items-center justify-end gap-1"
                        >
                          <input type="hidden" name="assetId" value={a.id} />
                          <input type="hidden" name="year" value={year} />
                          <input
                            name="amount"
                            autoFocus
                            inputMode="decimal"
                            defaultValue={depreciado ?? ""}
                            placeholder="0.00"
                            className="w-24 rounded border border-sky-300 px-2 py-1 text-right text-xs tabular-nums focus:outline-none"
                          />
                          <SaveBtn />
                          <button type="button" onClick={() => setEditing(null)} className="rounded px-1.5 py-1 text-[11px] text-slate-400 hover:bg-slate-100">
                            ✕
                          </button>
                        </form>
                      ) : (
                        <div className="flex items-center justify-end gap-1.5">
                          <span className={`tabular-nums ${depreciado == null ? "text-slate-300" : notDepreciated ? "text-rose-700" : "text-slate-800"}`}>
                            {depreciado == null ? "—" : m(depreciado)}
                          </span>
                          {notDepreciated && (
                            <span className="rounded bg-rose-50 px-1 py-0.5 text-[9px] text-rose-700" title={`The book didn't depreciate this asset for the year, but MACRS said ${m(deveria)}. ${disposedHere ? "At disposal, the year's depreciation wasn't taken — it becomes a larger loss on the sale (Section 1231)." : "This depreciation still needs to be reported."}`}>
                              not depreciated
                            </span>
                          )}
                          {isDerived && !notDepreciated && (
                            <span className="rounded bg-emerald-50 px-1 py-0.5 text-[9px] text-emerald-700" title="Comes from the asset record (fully depreciated / disposal). Edit with the pencil to override.">
                              record
                            </span>
                          )}
                          <button
                            onClick={() => setEditing(a.id)}
                            title="Edit the depreciated amount in the book"
                            className="rounded px-1 py-0.5 text-slate-400 hover:bg-slate-100 hover:text-sky-700"
                          >
                            ✎
                          </button>
                        </div>
                      )}
                    </td>
                    {view === "ano" ? (
                      <td className={`px-3 py-2 text-right tabular-nums ${diff == null ? "text-slate-300" : Math.abs(diff) <= 1 ? "text-slate-400" : "font-medium text-amber-700"}`}>
                        {diff == null ? "—" : m(diff)}
                      </td>
                    ) : (
                      <td className={`px-3 py-2 text-right tabular-nums ${Math.abs(catchUp) <= 1 ? "text-slate-400" : catchUp < 0 ? "font-medium text-rose-700" : "font-medium text-amber-700"}`} title={catchUp < -1 ? "Over-depreciated — nothing to report" : undefined}>
                        {m(catchUp)}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums text-slate-600">{m(saldoReal)}</td>
                  </tr>
                );
              })}
              {rowsForYear.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-4 text-center text-sm text-slate-400">
                    No asset in service in {year}.
                  </td>
                </tr>
              )}
            </tbody>
            {rowsForYear.length > 0 && (
              <tfoot className="sticky bottom-0 z-10 border-t-2 border-slate-200 bg-slate-50 text-slate-700 shadow-[0_-1px_0_0_rgb(226,232,240)]">
                <tr>
                  <td className="px-3 py-2 font-medium">Total</td>
                  <td></td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{m(view === "ano" ? totDeveria : totMacrsAccum)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{m(view === "ano" ? totDepreciado : totBookAccum)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">
                    {m(view === "ano" ? Math.round((totDeveria - totDepreciado) * 100) / 100 : totCatchUp)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* Match livro × IR declarado — confirma que o total alocado por ativo bate com o que o
            contador declarou no ano (mesmo que não bata com a MACRS). */}
        {irForYear != null && (
          <div
            className={`mt-3 flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
              matched ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
              <span className="text-slate-600">
                Reported on the return (Form 4562): <span className="font-semibold text-slate-800">{m(irForYear)}</span>
              </span>
              <span className="text-slate-600">
                Recorded in the book: <span className="font-semibold text-slate-800">{m(totDepreciado)}</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className={`font-medium ${matched ? "text-emerald-700" : "text-amber-700"}`}>
                {matched ? (
                  "✓ matches the reported tax return"
                ) : (
                  <>
                    {matchDiff! > 0 ? "still to allocate" : "over-allocated"} {m(Math.abs(matchDiff!))}
                  </>
                )}
              </div>
              {canDistribute && (
                <form action={distributeYearDepreciation}>
                  <input type="hidden" name="year" value={year} />
                  <input type="hidden" name="allocations" value={JSON.stringify(allocations)} />
                  <button
                    className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16304f]"
                    title={`Fills the ${candidates.length} assets without a value, proportional to MACRS (Should), until it matches the reported tax return. You can adjust each one with the pencil afterward.`}
                  >
                    Distribute {m(remaining)} proportionally
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        <p className="mt-2 shrink-0 text-[11px] text-slate-400">
          <strong>Should</strong> = MACRS for the year per asset. <strong>Depreciated</strong> = what
          was reported in the book. When the asset is already marked &ldquo;fully depreciated in the
          book&rdquo; or &ldquo;disposed&rdquo; (on its detail), the value comes from the{" "}
          <strong>record</strong> automatically (badge); the pencil overrides it. Empty = not yet
          recorded. <strong>Actual balance</strong> = cost − accumulated actual depreciation. The sum
          of &ldquo;Depreciated&rdquo; should match the tax return reported for the year.
        </p>
      </div>
    </div>
  );
}

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="rounded bg-[#1f3a5f] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#16304f] disabled:opacity-50">
      {pending ? "…" : "Save"}
    </button>
  );
}
