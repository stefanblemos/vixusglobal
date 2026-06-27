"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { formatMoney } from "@/lib/money";
import type { ReconYearRow, ReconStatus } from "@/lib/assets/reconcile-dep";
import { setAssetYearDepreciation, distributeYearDepreciation } from "@/lib/actions/assets";

export type AssetForRecon = {
  id: string;
  name: string;
  cost: number;
  macrsSchedule: { year: number; amount: number }[]; // MACRS PURA (deveria) — regra legal do IRS
  actualByYear: Record<string, number>; // ano → depreciação real registrada à mão (sobrescreve)
  derivedByYear: Record<string, number>; // ano → depreciação do livro DERIVADA (totalmente dep./baixa)
};

const STATUS: Record<ReconStatus, { label: string; cls: string }> = {
  ok: { label: "ok", cls: "bg-green-50 text-green-700" },
  faltou: { label: "não lançou", cls: "bg-red-50 text-red-700" },
  diferente: { label: "diverge", cls: "bg-amber-50 text-amber-700" },
  "sem-ir": { label: "sem IR", cls: "bg-slate-100 text-slate-500" },
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
              <th className="px-4 py-2 font-medium">Ano</th>
              <th className="px-3 py-2 text-right font-medium">MACRS (ano)</th>
              <th className="px-3 py-2 text-right font-medium">MACRS acumulada</th>
              <th className="px-3 py-2 text-right font-medium">IR (ano)</th>
              <th className="px-3 py-2 text-right font-medium">IR acum.</th>
              <th className="px-3 py-2 text-right font-medium">Diferença acum.</th>
              <th className="px-3 py-2 text-center font-medium">Situação</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const st = STATUS[r.status];
              const future = r.year > throughYear;
              return (
                <tr
                  key={r.year}
                  onClick={() => setOpenYear(r.year)}
                  className={`cursor-pointer hover:bg-sky-50/60 ${r.status === "faltou" ? "bg-red-50/40" : future ? "text-slate-400" : ""}`}
                  title="Clique para ver e registrar a depreciação por ativo neste ano"
                >
                  <td className="px-4 py-2 font-medium">{r.year}{future ? " (proj.)" : ""}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.macrs ? m(r.macrs) : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{m(r.macrsAccum)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.ir == null ? "—" : m(r.ir)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-500">{m(r.irAccum)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${Math.abs(r.accumDiff) <= 1 ? "text-slate-400" : "font-medium text-amber-700"}`}>
                    {m(r.accumDiff)}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${st.cls}`}>{st.label}</span>
                  </td>
                  <td className="px-2 py-2 text-right text-slate-300">›</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-400">
        <strong>Diferença acum.</strong> = MACRS acumulado − IR acumulado (quanto, no total, ainda
        falta lançar até aquele ano — não é a diferença de um ano só). Clique numa linha para ver e{" "}
        <strong>registrar a depreciação real por ativo</strong> naquele ano. Confira com o contador
        antes de deduzir tudo de uma vez (pode haver forma própria de recuperar depreciação omitida,
        ex.: Form 3115).
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
    // Em serviço no ano E ainda não totalmente baixado no livro ANTES deste ano (se já zerou em ano
    // anterior, sai do modal — não ocupa espaço; continua na lista de ativos).
    .filter((r) => r.acqYear <= year && r.accBefore < r.a.cost - 0.005)
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
      <div className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <div className="text-base font-medium text-slate-800">Depreciação por ativo — {year}</div>
            <div className="mt-0.5 text-xs text-slate-500">
              O que a MACRS diz que <strong>deveria</strong> ter sido depreciado × o que foi de fato
              lançado no livro. Edite no lápis para registrar o valor real por ativo. Em{" "}
              <strong>Acumulado</strong>, veja o total que deveria vs o real e o <strong>catch-up</strong>{" "}
              por ativo — positivo = falta lançar; negativo = já foi <strong>depreciado a maior</strong>{" "}
              (atenção, nada a lançar).
            </div>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            ✕
          </button>
        </div>

        {/* Toggle por ano × acumulado + referência */}
        <div className="my-3 flex flex-wrap items-center gap-2 text-xs">
          <div className="inline-flex overflow-hidden rounded-lg border border-slate-200">
            <button onClick={() => setView("ano")} className={`px-3 py-1.5 ${view === "ano" ? "bg-[#1f3a5f] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              Por ano
            </button>
            <button onClick={() => setView("acum")} className={`px-3 py-1.5 ${view === "acum" ? "bg-[#1f3a5f] text-white" : "bg-white text-slate-600 hover:bg-slate-50"}`}>
              Acumulado
            </button>
          </div>
          {view === "ano" ? (
            <>
              <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-600">
                MACRS do ano (deveria): <span className="font-semibold tabular-nums text-slate-800">{m(macrsForYear)}</span>
              </span>
              <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-600">
                IR declarado no ano:{" "}
                <span className="font-semibold tabular-nums text-slate-800">{irForYear == null ? "—" : m(irForYear)}</span>
              </span>
              <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-600">
                Registrado por ativo: <span className="font-semibold tabular-nums text-slate-800">{m(totDepreciado)}</span>{" "}
                ({registrados}/{rowsForYear.length})
              </span>
            </>
          ) : (
            <>
              <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-600">
                MACRS acum. (deveria) até {year}: <span className="font-semibold tabular-nums text-slate-800">{m(totMacrsAccum)}</span>
              </span>
              <span className="rounded-lg bg-slate-50 px-3 py-1.5 text-slate-600">
                Depreciado acum. (livro): <span className="font-semibold tabular-nums text-slate-800">{m(totBookAccum)}</span>
              </span>
              {Math.abs(totCatchUp) <= 1 ? (
                <span className="rounded-lg bg-emerald-50 px-3 py-1.5 text-emerald-700">
                  Conciliado: nada a lançar
                </span>
              ) : totCatchUp > 0 ? (
                <span className="rounded-lg bg-amber-50 px-3 py-1.5 text-amber-700">
                  Catch-up a lançar: <span className="font-semibold tabular-nums">{m(totCatchUp)}</span>
                </span>
              ) : (
                <span className="rounded-lg bg-rose-50 px-3 py-1.5 text-rose-700">
                  ⚠ Depreciado a maior: <span className="font-semibold tabular-nums">{m(Math.abs(totCatchUp))}</span> — nada a lançar
                </span>
              )}
            </>
          )}
        </div>

        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">Ativo</th>
                <th className="px-3 py-2 text-right font-medium">Valor original</th>
                <th className="px-3 py-2 text-right font-medium">{view === "ano" ? "Deveria (MACRS)" : "MACRS acum. (deveria)"}</th>
                <th className="px-3 py-2 text-right font-medium">{view === "ano" ? "Depreciado (livro)" : "Depreciado acum. (livro)"}</th>
                <th className="px-3 py-2 text-right font-medium">{view === "ano" ? "Diferença" : "Catch-up"}</th>
                <th className="px-3 py-2 text-right font-medium">Saldo real</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rowsForYear.map(({ a, deveria, depreciado, isDerived, saldoReal, macrsAccum, bookAccum, catchUp }) => {
                const diff = depreciado == null ? null : Math.round((deveria - depreciado) * 100) / 100;
                return (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-medium text-slate-700">{a.name}</td>
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
                          <span className={`tabular-nums ${depreciado == null ? "text-slate-300" : "text-slate-800"}`}>
                            {depreciado == null ? "—" : m(depreciado)}
                          </span>
                          {isDerived && (
                            <span className="rounded bg-emerald-50 px-1 py-0.5 text-[9px] text-emerald-700" title="Vem do cadastro do ativo (totalmente depreciado / baixa). Edite no lápis para sobrescrever.">
                              cadastro
                            </span>
                          )}
                          <button
                            onClick={() => setEditing(a.id)}
                            title="Editar valor depreciado no livro"
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
                      <td className={`px-3 py-2 text-right tabular-nums ${Math.abs(catchUp) <= 1 ? "text-slate-400" : catchUp < 0 ? "font-medium text-rose-700" : "font-medium text-amber-700"}`} title={catchUp < -1 ? "Depreciado a maior — nada a lançar" : undefined}>
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
                    Nenhum ativo em serviço em {year}.
                  </td>
                </tr>
              )}
            </tbody>
            {rowsForYear.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 bg-slate-50/60 text-slate-700">
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
            className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-sm ${
              matched ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"
            }`}
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 tabular-nums">
              <span className="text-slate-600">
                IR declarado (Form 4562): <span className="font-semibold text-slate-800">{m(irForYear)}</span>
              </span>
              <span className="text-slate-600">
                Registrado no livro: <span className="font-semibold text-slate-800">{m(totDepreciado)}</span>
              </span>
            </div>
            <div className="flex items-center gap-3">
              <div className={`font-medium ${matched ? "text-emerald-700" : "text-amber-700"}`}>
                {matched ? (
                  "✓ bate com o IR declarado"
                ) : (
                  <>
                    {matchDiff! > 0 ? "falta alocar" : "alocado a mais"} {m(Math.abs(matchDiff!))}
                  </>
                )}
              </div>
              {canDistribute && (
                <form action={distributeYearDepreciation}>
                  <input type="hidden" name="year" value={year} />
                  <input type="hidden" name="allocations" value={JSON.stringify(allocations)} />
                  <button
                    className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#16304f]"
                    title={`Preenche os ${candidates.length} ativos sem valor, proporcional à MACRS (Deveria), até bater com o IR declarado. Você pode ajustar cada um no lápis depois.`}
                  >
                    Distribuir {m(remaining)} proporcional
                  </button>
                </form>
              )}
            </div>
          </div>
        )}

        <p className="mt-2 text-[11px] text-slate-400">
          <strong>Deveria</strong> = MACRS do ano por ativo. <strong>Depreciado</strong> = o que foi
          lançado no livro. Quando o ativo já está marcado &ldquo;totalmente depreciado no livro&rdquo;
          ou &ldquo;baixado&rdquo; (na ficha), o valor vem do <strong>cadastro</strong> automaticamente
          (badge); o lápis sobrescreve. Vazio = ainda não registrado. <strong>Saldo real</strong> =
          custo − depreciação real acumulada. A soma de &ldquo;Depreciado&rdquo; deveria bater com o
          IR declarado no ano.
        </p>
      </div>
    </div>
  );
}

function SaveBtn() {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="rounded bg-[#1f3a5f] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#16304f] disabled:opacity-50">
      {pending ? "…" : "Salvar"}
    </button>
  );
}
