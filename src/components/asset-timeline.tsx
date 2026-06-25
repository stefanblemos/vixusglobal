"use client";

import { useEffect, useState } from "react";
import type { AssetView } from "@/lib/assets/depreciation";
import { deleteAsset } from "@/lib/actions/assets";

// Ficha por ativo: abre ao clicar na lista e mostra a linha do tempo da depreciação
// (depreciação no ano · acumulada · saldo restante). A baixa/venda é uma simulação ao vivo
// (half-year no ano da baixa) — persistir + alimentar o Faturamento é o próximo passo.

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.round(n));

type Row = { year: number; amt: number; acc: number; rem: number };

function scheduleRows(a: AssetView, disposalYear?: number): Row[] {
  const out: Row[] = [];
  let acc = 0;
  for (const y of a.schedule) {
    if (disposalYear && y.year > disposalYear) break;
    const amt = disposalYear && y.year === disposalYear ? y.amount * 0.5 : y.amount;
    acc += amt;
    out.push({ year: y.year, amt, acc, rem: Math.max(0, a.cost - acc) });
  }
  return out;
}

export function AssetTimeline({ assets, year }: { assets: AssetView[]; year: number }) {
  const [selId, setSelId] = useState<string | null>(null);
  const [disp, setDisp] = useState<Record<string, number | undefined>>(() =>
    Object.fromEntries(
      assets.filter((a) => a.disposalDate).map((a) => [a.id, Number(a.disposalDate!.slice(0, 4))]),
    ),
  );

  // Fecha o modal com Esc.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setSelId(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  if (assets.length === 0) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-400">
        No assets yet. Add one above.
      </div>
    );
  }

  const sel = selId ? (assets.find((a) => a.id === selId) ?? null) : null;

  return (
    <>
      {/* Lista de ativos (clicável) — clique abre a ficha em modal */}
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {assets.map((a, i) => {
          const rows = scheduleRows(a, disp[a.id]);
          const r = rows.find((x) => x.year === year);
          return (
            <button
              key={a.id}
              onClick={() => setSelId(a.id)}
              className={`flex w-full items-center gap-3 px-4 py-2.5 text-left ${i > 0 ? "border-t border-slate-100" : ""} hover:bg-slate-50`}
            >
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-slate-800">{a.name}</div>
                <div className="text-xs text-slate-500">
                  {a.companyName} · {a.categoryLabel} · {a.recoveryYears}yr · entrada {a.acquisitionDate} · {money(a.cost)}
                </div>
              </div>
              <div className="shrink-0 text-right tabular-nums">
                <div className="text-sm text-slate-800">{r ? money(r.amt) : "—"}</div>
                <div className="text-[11px] text-slate-500">dep {year}</div>
              </div>
              {disp[a.id] && (
                <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                  baixado {disp[a.id]}
                </span>
              )}
              <span className="shrink-0 text-slate-300">›</span>
            </button>
          );
        })}
      </div>

      {/* Modal da ficha */}
      {sel && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
          onClick={() => setSelId(null)}
        >
          <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <AssetDetail
              a={sel}
              year={year}
              disposalYear={disp[sel.id]}
              onDisposal={(y) => setDisp((p) => ({ ...p, [sel.id]: y }))}
              onClose={() => setSelId(null)}
            />
          </div>
        </div>
      )}
    </>
  );
}

function AssetDetail({
  a,
  year,
  disposalYear,
  onDisposal,
  onClose,
}: {
  a: AssetView;
  year: number;
  disposalYear?: number;
  onDisposal: (y: number | undefined) => void;
  onClose?: () => void;
}) {
  const rows = scheduleRows(a, disposalYear);
  const accCur = [...rows].filter((r) => r.year <= year).pop()?.acc ?? 0;
  const remCur = Math.max(0, a.cost - accCur);
  const depCur = rows.find((r) => r.year === year)?.amt ?? 0;
  const max = Math.max(1, ...rows.map((r) => r.amt));

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-base font-medium text-slate-800">{a.name}</div>
          <div className="mt-0.5 text-xs text-slate-500">
            {a.categoryLabel} · {a.method === "SL_MM" ? "Straight-line mid-month" : `MACRS ${a.recoveryYears}yr (half-year)`} · entrada {a.acquisitionDate} · custo {money(a.cost)}
            {a.section179 > 0 ? ` · §179 ${money(a.section179)}` : ""}
            {a.bonusPct > 0 ? ` · bonus ${a.bonusPct}%` : ""}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700">linha do tempo</span>
          {onClose && (
            <button onClick={onClose} aria-label="Fechar" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">
              ✕
            </button>
          )}
        </div>
      </div>

      <div className="my-3 grid grid-cols-3 gap-2.5">
        <Metric label={`Depreciação ${year}`} value={money(depCur)} />
        <Metric label={`Acumulada até ${year}`} value={money(accCur)} />
        <Metric label="Saldo restante" value={money(remCur)} accent />
      </div>

      <div className="grid grid-cols-[44px_1fr_88px_88px_88px] items-center gap-2 border-b border-slate-100 pb-1.5 text-[11px] text-slate-400">
        <div>Ano</div>
        <div>Depreciação no ano</div>
        <div className="text-right">Valor</div>
        <div className="text-right">Acumulada</div>
        <div className="text-right">Saldo</div>
      </div>
      {rows.map((r) => {
        const isCur = r.year === year;
        const fut = r.year > year;
        const part = disposalYear === r.year;
        const barColor = isCur ? "bg-[#8DC63F]" : fut ? "bg-slate-300" : "bg-[#1f3a5f]";
        return (
          <div key={r.year} className="grid grid-cols-[44px_1fr_88px_88px_88px] items-center gap-2 py-1 text-xs">
            <div className="font-medium text-slate-700">{r.year}</div>
            <div className="flex items-center gap-2">
              <div className={`h-3.5 rounded ${barColor}`} style={{ width: `${Math.max(4, (r.amt / max) * 100)}%` }} />
              {part && (
                <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">parcial (half-year)</span>
              )}
              {isCur && !part && (
                <span className="rounded-full bg-[#8DC63F]/20 px-1.5 py-0.5 text-[10px] text-[#3B6D11]">estimado</span>
              )}
              {fut && <span className="text-[10px] text-slate-400">projeção</span>}
            </div>
            <div className="text-right tabular-nums text-slate-800">{money(r.amt)}</div>
            <div className="text-right tabular-nums text-slate-500">{money(r.acc)}</div>
            <div className="text-right tabular-nums text-slate-500">{money(r.rem)}</div>
          </div>
        );
      })}

      <div className="mt-3 flex flex-wrap items-center gap-2.5 border-t border-slate-100 pt-3">
        <label className="flex items-center gap-2 text-xs text-slate-700">
          <input
            type="checkbox"
            checked={disposalYear != null}
            onChange={(e) => onDisposal(e.target.checked ? (disposalYear ?? year) : undefined)}
            className="h-4 w-4 rounded border-slate-300"
          />
          vendido / baixado
        </label>
        <select
          value={disposalYear ?? ""}
          disabled={disposalYear == null}
          onChange={(e) => onDisposal(Number(e.target.value))}
          className="rounded-lg border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
        >
          {a.schedule.map((y) => (
            <option key={y.year} value={y.year}>{y.year}</option>
          ))}
        </select>
        <span className="text-xs text-slate-500">
          no ano da baixa: metade da cota (half-year) e para depois. Simulação — persistir é o próximo passo.
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#1f3a5f] align-middle" />lançado</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#8DC63F] align-middle" />estimado (entra no Faturamento)</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-slate-300 align-middle" />projeção</span>
        </div>
        <form action={deleteAsset}>
          <input type="hidden" name="id" value={a.id} />
          <button className="text-xs text-slate-300 hover:text-red-600" title="Remover ativo">
            Remover ✕
          </button>
        </form>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-lg bg-slate-50 px-3 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-0.5 text-xl font-semibold tabular-nums ${accent ? "text-[#3B6D11]" : "text-slate-800"}`}>{value}</div>
    </div>
  );
}
