"use client";

import { useEffect, useState } from "react";
import type { AssetView } from "@/lib/assets/depreciation";
import { deleteAsset, renameAsset, setFullyDepreciated, setDisposal, revertAssetEntries, mergeAssets } from "@/lib/actions/assets";

// Versão leve de ativo (para o seletor de merge) — só o que importa para compatibilidade.
export type AssetLite = {
  id: string;
  companyId: string;
  name: string;
  cost: number;
  acquisitionDate: string;
  method: string;
  recoveryYears: number;
};

// Ficha por ativo: abre ao clicar na lista e mostra a linha do tempo da depreciação
// (depreciação no ano · acumulada · saldo restante). Baixa/venda e "totalmente depreciado no livro"
// são persistidos (o motor já embute na linha do tempo) — confirmados pelo usuário.

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.round(n));

const disposalYearOf = (a: AssetView): number | null => (a.disposalDate ? Number(a.disposalDate.slice(0, 4)) : null);

type Row = { year: number; amt: number; acc: number; rem: number };

// A baixa/venda já vem embutida em a.schedule (motor) — aqui só acumulamos.
function scheduleRows(a: AssetView): Row[] {
  const out: Row[] = [];
  let acc = 0;
  for (const y of a.schedule) {
    acc += y.amount;
    out.push({ year: y.year, amt: y.amount, acc, rem: Math.max(0, a.cost - acc) });
  }
  return out;
}

export function AssetTimeline({
  assets,
  year,
  allAssets,
  actualByAsset = {},
  pureScheduleById = {},
}: {
  assets: AssetView[];
  year: number;
  allAssets: AssetLite[];
  actualByAsset?: Record<string, Record<string, number>>; // ativo → ano → depreciação REAL lançada no livro
  pureScheduleById?: Record<string, { year: number; amount: number }[]>; // ativo → MACRS pura (estimado)
}) {
  const [selId, setSelId] = useState<string | null>(null);
  const [showDepleted, setShowDepleted] = useState(false);

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

  // 100% depreciado em ANO ANTERIOR: ou o cronograma MACRS terminou antes do ano, ou o livro já
  // zerou o ativo antes do ano (depreciação real lançada na conferência ≥ custo — pega o caso do
  // contador que expensou 100% sem marcar a flag). Terreno (schedule vazio) não conta. Ocultos por
  // padrão; checkbox mostra, com a contagem.
  const isDepleted = (a: AssetView) => {
    const last = a.schedule.length ? a.schedule[a.schedule.length - 1].year : null;
    const scheduleDone = last != null && last < year;
    const bookDone = a.bookDepletedYear != null && a.bookDepletedYear < year;
    return scheduleDone || bookDone;
  };
  const depletedCount = assets.filter(isDepleted).length;
  const visible = showDepleted ? assets : assets.filter((a) => !isDepleted(a));

  return (
    <>
      {depletedCount > 0 && (
        <div className="flex justify-end">
          <label className="flex items-center gap-2 text-xs text-slate-500">
            <input
              type="checkbox"
              checked={showDepleted}
              onChange={(e) => setShowDepleted(e.target.checked)}
              className="h-4 w-4 rounded border-slate-300"
            />
            Mostrar 100% depreciados
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
              {depletedCount} oculto{depletedCount > 1 ? "s" : ""}
            </span>
          </label>
        </div>
      )}

      {/* Lista de ativos em tabela (clicável) — clique na linha abre a ficha em modal */}
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Ativo</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Valor original</th>
              <th className="px-3 py-2 font-medium whitespace-nowrap">Entrada</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Deprec. acumulada</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Saldo a depreciar</th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">Previsão {year}</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {visible.map((a) => {
              const rows = scheduleRows(a);
              const dispYr = disposalYearOf(a);
              // Valores do ano selecionado (baixa já embutida no schedule).
              const accCur = [...rows].filter((r) => r.year <= year).pop()?.acc ?? 0;
              const remCur = Math.max(0, a.cost - accCur);
              const depCur = rows.find((r) => r.year === year)?.amt ?? 0;
              // Marcador: futuro (entra depois do ano) / terreno / totalmente depreciado (flag, livro
              // real ou cronograma MACRS).
              const acqY = Number(a.acquisitionDate.slice(0, 4));
              const lastY = a.schedule.length ? a.schedule[a.schedule.length - 1].year : null;
              const tag =
                acqY > year
                  ? { t: `entra em ${acqY}`, c: "bg-sky-50 text-sky-700" }
                  : a.fullyDepreciatedYear != null
                    ? { t: `totalmente depreciado (livro ${a.fullyDepreciatedYear})`, c: "bg-emerald-50 text-emerald-700" }
                    : a.bookDepletedYear != null && a.bookDepletedYear <= year
                      ? { t: `totalmente depreciado (livro ${a.bookDepletedYear})`, c: "bg-emerald-50 text-emerald-700" }
                      : a.schedule.length === 0
                        ? { t: "não deprecia", c: "bg-slate-100 text-slate-500" }
                        : lastY !== null && lastY < year
                          ? { t: "totalmente depreciado", c: "bg-emerald-50 text-emerald-700" }
                          : null;
              return (
                <tr key={a.id} onClick={() => setSelId(a.id)} className="cursor-pointer hover:bg-slate-50">
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-medium text-slate-800">{a.name}</span>
                      {tag && <span className={`rounded-full px-2 py-0.5 text-[11px] ${tag.c}`}>{tag.t}</span>}
                      {dispYr && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">baixado {dispYr}</span>
                      )}
                    </div>
                    <div className="text-xs text-slate-500">{a.companyName} · {a.categoryLabel} · {a.recoveryYears}yr</div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money(a.cost)}</td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{a.acquisitionDate}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{money(accCur)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{money(remCur)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium text-slate-800">{depCur ? money(depCur) : "—"}</td>
                  <td className="px-2 py-2 text-right text-slate-300">›</td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
              allAssets={allAssets}
              actualByYear={actualByAsset[sel.id] ?? {}}
              pureSchedule={pureScheduleById[sel.id] ?? sel.schedule}
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
  allAssets,
  actualByYear,
  pureSchedule,
  onClose,
}: {
  a: AssetView;
  year: number;
  allAssets: AssetLite[];
  actualByYear: Record<string, number>;
  pureSchedule: { year: number; amount: number }[];
  onClose?: () => void;
}) {
  // Candidatos a merge: mesma empresa + compatíveis (data, método, vida). Incompatível não aparece.
  const mergeCandidates = allAssets.filter(
    (x) =>
      x.id !== a.id &&
      x.companyId === a.companyId &&
      x.acquisitionDate === a.acquisitionDate &&
      x.method === a.method &&
      x.recoveryYears === a.recoveryYears,
  );
  const rows = scheduleRows(a);
  const disposalYear = disposalYearOf(a);
  const accCur = [...rows].filter((r) => r.year <= year).pop()?.acc ?? 0;
  const remCur = Math.max(0, a.cost - accCur);
  const depCur = rows.find((r) => r.year === year)?.amt ?? 0;
  const max = Math.max(1, ...rows.map((r) => r.amt));
  // Anos candidatos para a baixa (aquisição → projeção). a.schedule pode estar truncado, então
  // garantimos pelo menos do ano de aquisição até o ano corrente + 1.
  const acqYear = Number(a.acquisitionDate.slice(0, 4));
  const lastSched = a.schedule.length ? a.schedule[a.schedule.length - 1].year : acqYear;
  const disposalYears: number[] = [];
  for (let y = acqYear; y <= Math.max(lastSched, year, disposalYear ?? 0); y++) disposalYears.push(y);

  // Estimado (MACRS pura "deveria") × Real (o que foi de fato lançado no livro). Real por ano =
  // valor manual (AssetYearDepreciation) ?? derivado do cadastro quando há sinal de livro (totalmente
  // depreciado/baixa → o schedule efetivo já reflete o livro).
  const hasBookSignal = a.fullyDepreciatedYear != null || a.disposalDate != null;
  const realOf = (y: number): number | undefined =>
    actualByYear[String(y)] ?? (hasBookSignal ? a.schedule.find((s) => s.year === y)?.amount : undefined);
  const cmpYears = [...new Set([...pureSchedule.map((s) => s.year), ...Object.keys(actualByYear).map(Number)])].sort((x, z) => x - z);
  // Saldos até o ano: simulado (MACRS pura) × real (livro).
  const estAccThruYear = pureSchedule.reduce((s, x) => (x.year <= year ? s + x.amount : s), 0);
  const realAccThruYear = cmpYears.reduce((s, y) => (y <= year ? s + (realOf(y) ?? 0) : s), 0);
  const saldoSimulado = Math.max(0, a.cost - estAccThruYear);
  const saldoReal = Math.max(0, a.cost - realAccThruYear);
  // 100% depreciado no LIVRO até o ANO selecionado: marcado/detectado até o ano, ou o real acumulado
  // até o ano já cobre o custo. (Relativo ao ano — não marca um ativo antes de ele ter zerado.)
  const is100 =
    (a.fullyDepreciatedYear != null && a.fullyDepreciatedYear <= year) ||
    (a.bookDepletedYear != null && a.bookDepletedYear <= year) ||
    realAccThruYear >= a.cost - 0.5;
  // Linhas estimado×real (acumulado real corrente) — usado na tabela quando is100.
  let realRun = 0;
  const cmpRows = cmpYears.map((y) => {
    const est = pureSchedule.find((s) => s.year === y)?.amount ?? 0;
    const real = realOf(y) ?? 0;
    realRun += real;
    return { year: y, est, real, realAcc: realRun, saldoReal: Math.max(0, a.cost - realRun) };
  });

  return (
    <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-xl">
      {is100 && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center overflow-hidden">
          <span
            className="select-none whitespace-nowrap text-6xl font-extrabold uppercase tracking-widest text-emerald-600/15"
            style={{ transform: "rotate(-28deg)" }}
          >
            100% depreciado
          </span>
        </div>
      )}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <form action={renameAsset} className="flex flex-wrap items-center gap-1.5">
            <input type="hidden" name="id" value={a.id} />
            <input
              name="name"
              defaultValue={a.name}
              className="min-w-0 flex-1 rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 text-base font-medium text-slate-800 hover:border-slate-200 focus:border-sky-300 focus:bg-white focus:outline-none"
              title="Editar nome do ativo"
            />
            <input
              type="date"
              name="acquisitionDate"
              defaultValue={a.acquisitionDate}
              className="shrink-0 rounded-lg border border-transparent bg-transparent px-1.5 py-0.5 text-xs text-slate-600 hover:border-slate-200 focus:border-sky-300 focus:bg-white focus:outline-none"
              title="Editar data de entrada em serviço"
            />
            <div className="flex shrink-0 items-center gap-0.5 text-xs text-slate-600">
              <span className="text-slate-400">$</span>
              <input
                type="number"
                name="cost"
                step="0.01"
                min="0"
                defaultValue={a.cost}
                className="w-24 rounded-lg border border-transparent bg-transparent px-1 py-0.5 text-right text-xs text-slate-600 hover:border-slate-200 focus:border-sky-300 focus:bg-white focus:outline-none"
                title="Editar valor de entrada (base da depreciação)"
              />
            </div>
            <button className="shrink-0 rounded-lg px-2 py-0.5 text-[11px] text-slate-400 hover:bg-slate-100 hover:text-sky-700" title="Salvar nome, data de entrada e custo">
              salvar
            </button>
          </form>
          <div className="mt-0.5 px-1.5 text-xs text-slate-500">
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
        {is100 ? (
          <div className="rounded-lg bg-slate-50 px-3 py-2.5">
            <div className="text-xs text-slate-500">Saldo — simulado · real</div>
            <div className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-xl font-semibold tabular-nums text-slate-400" title="Saldo pela MACRS (estimado)">{money(saldoSimulado)}</span>
              <span className="text-slate-300">·</span>
              <span className="text-xl font-semibold tabular-nums text-[#3B6D11]" title="Saldo real pelo livro">{money(saldoReal)}</span>
            </div>
          </div>
        ) : (
          <Metric label="Saldo restante" value={money(remCur)} accent />
        )}
      </div>

      {is100 ? (
        /* 100% depreciado: comparativo estimado (MACRS) × real (livro) por ano. */
        <>
          <div className="grid grid-cols-[40px_1fr_1fr_1fr_1fr] items-center gap-2 border-b border-slate-100 pb-1.5 text-[11px] text-slate-400">
            <div>Ano</div>
            <div className="text-right">Estimado (MACRS)</div>
            <div className="text-right">Real (livro)</div>
            <div className="text-right">Acum. real</div>
            <div className="text-right">Saldo real</div>
          </div>
          {cmpRows.map((r) => {
            const fut = r.year > year;
            return (
              <div key={r.year} className="grid grid-cols-[40px_1fr_1fr_1fr_1fr] items-center gap-2 py-1 text-xs">
                <div className="font-medium text-slate-700">{r.year}{fut ? "*" : ""}</div>
                <div className="text-right tabular-nums text-slate-400">{r.est > 0.005 ? money(r.est) : "—"}</div>
                <div className={`text-right tabular-nums ${r.real > 0.005 ? "font-medium text-slate-800" : "text-slate-300"}`}>
                  {r.real > 0.005 ? money(r.real) : "—"}
                </div>
                <div className="text-right tabular-nums text-slate-500">{money(r.realAcc)}</div>
                <div className="text-right tabular-nums text-slate-500">{money(r.saldoReal)}</div>
              </div>
            );
          })}
          <p className="mt-1 text-[10px] text-slate-400">
            <span className="text-slate-400">Estimado</span> = MACRS pura (deveria). <span className="text-slate-700">Real</span> ={" "}
            o que foi lançado no livro. <span className="text-[#3B6D11]">*</span> projeção MACRS após {year}.
          </p>
        </>
      ) : (
        <>
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
        </>
      )}

      {/* Situação do ativo — dois ajustes manuais, cada um confirmado pelo usuário. */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        <div className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-400">Situação do ativo</div>
        <div className="grid gap-3 sm:grid-cols-2">
          {/* Card 1 — Vendido / baixado */}
          <form action={setDisposal} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <input type="hidden" name="id" value={a.id} />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Vendido / baixado</span>
              {disposalYear != null && (
                <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-700">baixado {disposalYear}</span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              O ativo saiu da empresa. No ano da baixa entra metade da cota (half-year) e <strong>para
              de depreciar</strong> depois.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-[11px] text-slate-600">Ano da baixa</label>
              <select
                name="disposalYear"
                defaultValue={disposalYear ?? ""}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs tabular-nums focus:border-sky-400 focus:outline-none"
              >
                <option value="">— não vendido —</option>
                {disposalYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button className="rounded-lg bg-[#1f3a5f] px-3 py-1 text-xs font-medium text-white hover:bg-[#16304f]">
                Confirmar
              </button>
            </div>
          </form>

          {/* Card 2 — Totalmente depreciado no livro */}
          <form action={setFullyDepreciated} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <input type="hidden" name="id" value={a.id} />
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-slate-700">Totalmente depreciado no livro</span>
              {a.fullyDepreciatedYear != null && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700">livro {a.fullyDepreciatedYear}</span>
              )}
            </div>
            <p className="mt-0.5 text-[11px] text-slate-500">
              O contador já zerou o ativo no livro (tudo num ano). O app <strong>para de projetar</strong>{" "}
              depreciação futura. Deixe vazio para a MACRS normal.
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="text-[11px] text-slate-600">Zerado até o ano</label>
              <select
                name="fullyDepreciatedYear"
                defaultValue={a.fullyDepreciatedYear ?? ""}
                className="rounded-lg border border-slate-300 px-2 py-1 text-xs tabular-nums focus:border-sky-400 focus:outline-none"
              >
                <option value="">— MACRS normal —</option>
                {disposalYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <button className="rounded-lg bg-[#1f3a5f] px-3 py-1 text-xs font-medium text-white hover:bg-[#16304f]">
                Confirmar
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* Mesclar com outro ativo compatível (vieram separados no livro mas são um só). */}
      {mergeCandidates.length > 0 && (
        <form action={mergeAssets} className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
          <input type="hidden" name="targetId" value={a.id} />
          <span className="text-xs font-medium text-slate-700">Mesclar com</span>
          <select name="sourceId" required defaultValue="" className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
            <option value="" disabled>selecione…</option>
            {mergeCandidates.map((c) => (
              <option key={c.id} value={c.id}>{c.name} ({money(c.cost)})</option>
            ))}
          </select>
          <button
            onClick={(e) => {
              if (!confirm("Mesclar este ativo com o selecionado? Soma os custos e os valores por ano NESTE ativo e DELETA o outro.")) e.preventDefault();
            }}
            className="rounded-lg bg-[#1f3a5f] px-3 py-1 text-xs font-medium text-white hover:bg-[#16304f]"
            title="Soma custo + valores por ano neste ativo e remove o outro (só compatíveis aparecem)"
          >
            Mesclar
          </button>
          <span className="basis-full text-[11px] text-slate-400">
            Soma o custo e os valores por ano <strong>neste</strong> ativo (mantém nome/data daqui) e
            remove o outro. Só aparecem ativos compatíveis (mesma data, método e vida).
          </span>
        </form>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-3 text-[11px] text-slate-400">
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#1f3a5f] align-middle" />lançado</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-[#8DC63F] align-middle" />estimado (entra no Faturamento)</span>
          <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm bg-slate-300 align-middle" />projeção</span>
        </div>
        <div className="flex items-center gap-3">
          <form action={revertAssetEntries}>
            <input type="hidden" name="id" value={a.id} />
            <button
              onClick={(e) => {
                if (!confirm("Reverter os lançamentos deste ativo? Remove a baixa, o “totalmente depreciado” e TODOS os valores de depreciação por ano registrados. A base (nome, custo, data) fica. Você pode refazer depois.")) e.preventDefault();
              }}
              className="text-xs text-slate-400 hover:text-amber-700"
              title="Limpar baixa, totalmente depreciado e valores por ano — volta ao estado limpo (MACRS pura)"
            >
              ↺ Reverter lançamentos
            </button>
          </form>
          <form action={deleteAsset}>
            <input type="hidden" name="id" value={a.id} />
            <button
              onClick={(e) => {
                if (!confirm("Remover este ativo? Apaga o ativo e todos os valores registrados dele.")) e.preventDefault();
              }}
              className="text-xs text-slate-300 hover:text-red-600"
              title="Remover ativo"
            >
              Remover ✕
            </button>
          </form>
        </div>
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
