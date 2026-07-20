"use client";

import { useState, useTransition } from "react";
import { requestHouseDraw, toggleHouseMilestone } from "@/lib/actions/milestones";

// Painel de marcos de construção da casa (#73). Checklist ponderado → % de obra → draw
// esperado (estimativa % × loan) com botão "Requisitar draw". Investidor vê só o andamento.

export type MilestoneRow = {
  key: string;
  name: string;
  detail: string | null;
  weightPct: number;
  cumPct: number;
  done: boolean;
  date: string | null;
};

const money = (n: number) => "US$" + Math.round(n).toLocaleString("en-US");

export function HouseMilestonesPanel({
  houseId,
  rows,
  pct,
  loanAmount,
  hasLoan,
  expectedCumulative,
  toRequest,
  alreadyDrawn,
  usingBudget = false,
  retained = 0,
}: {
  houseId: string;
  rows: MilestoneRow[];
  pct: number;
  loanAmount: number;
  hasLoan: boolean;
  expectedCumulative: number;
  toRequest: number;
  alreadyDrawn: number;
  usingBudget?: boolean;
  retained?: number;
}) {
  const [pending, start] = useTransition();
  const [drawState, setDrawState] = useState<{ error?: string; ok?: boolean } | null>(null);
  const today = new Date().toISOString().slice(0, 10);

  const toggle = (key: string, done: boolean) => {
    const fd = new FormData();
    fd.set("houseId", houseId);
    fd.set("key", key);
    fd.set("done", String(done));
    fd.set("date", today);
    start(async () => {
      await toggleHouseMilestone(fd);
    });
  };

  const doRequest = () => {
    const fd = new FormData();
    fd.set("houseId", houseId);
    start(async () => {
      const r = await requestHouseDraw(fd);
      setDrawState(r ?? null);
    });
  };

  return (
    <section className="mt-4 rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Marcos de construção</h2>
          <p className="mt-0.5 text-xs text-slate-400">Marque as fases concluídas — o % de obra e o draw esperado saem daqui.</p>
        </div>
        <div className="ml-auto text-right">
          <div className="text-2xl font-extrabold tabular-nums text-[#1f3a5f]">{pct}%</div>
          <div className="text-[11px] text-slate-400">obra concluída</div>
        </div>
      </div>
      <div className="h-2.5 bg-slate-100">
        <div className="h-full bg-gradient-to-r from-[#1f3a5f] to-[#2d5288] transition-all" style={{ width: `${pct}%` }} />
      </div>

      <ul className="px-3 py-2">
        {rows.map((m) => (
          <li key={m.key}>
            <label className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm hover:bg-slate-50 ${pending ? "opacity-60" : ""}`}>
              <input
                type="checkbox"
                checked={m.done}
                disabled={pending}
                onChange={(e) => toggle(m.key, e.target.checked)}
                className="h-4.5 w-4.5 accent-[#1f3a5f]"
                style={{ width: 18, height: 18 }}
              />
              <span className="flex-1">
                <span className={m.done ? "font-semibold text-emerald-700" : "text-slate-700"}>{m.name}</span>
                {m.detail && <small className="block text-[11px] text-slate-400">{m.detail}</small>}
                {m.done && m.date && <small className="block text-[10.5px] text-emerald-600">concluído em {m.date}</small>}
              </span>
              <span className="w-10 text-right text-[13px] font-bold text-slate-500">{m.weightPct}%</span>
              <span className="w-12 text-right text-[11px] text-slate-400">Σ {m.cumPct}%</span>
            </label>
          </li>
        ))}
      </ul>

      {/* draw */}
      <div className="m-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-[#1f3a5f]">
          Draw esperado × sacado
          <span className={`rounded-full px-2 py-0.5 text-[9px] ${usingBudget ? "bg-emerald-100 text-emerald-700" : "bg-slate-200 text-slate-500"}`}>
            {usingBudget ? "budget do banco" : "estimativa"}
          </span>
        </h3>
        {!hasLoan ? (
          <p className="text-xs text-slate-500">A casa não tem financiamento vinculado — vincule na aba Financiamento para estimar o draw.</p>
        ) : (
          <>
            <div className="flex justify-between py-0.5 text-[13px]">
              <span>{usingBudget ? "Draw esperado (linhas do budget concluídas)" : `Draw esperado (${pct}% × loan de ${money(loanAmount)})`}</span>
              <b>{money(expectedCumulative)}</b>
            </div>
            {usingBudget && retained > 0 && (
              <div className="flex justify-between py-0.5 text-[12px] text-slate-400">
                <span>Retido pelo banco (libera no CO)</span>
                <b>−{money(retained)}</b>
              </div>
            )}
            <div className="flex justify-between py-0.5 text-[13px]">
              <span>Já sacado / pedido</span>
              <b>{money(alreadyDrawn)}</b>
            </div>
            <div className="flex justify-between py-0.5 text-[13px]">
              <span className="text-slate-600">A requisitar</span>
              <b className="text-[#b45309]">{money(toRequest)}</b>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={doRequest}
                disabled={pending || toRequest <= 0}
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-40"
                title={toRequest <= 0 ? "Nada a requisitar no % de obra atual." : undefined}
              >
                {pending ? "Processando…" : "Requisitar draw"}
              </button>
              <span className="text-[11px] text-slate-400">
                Cria um draw pendente no loan (aguardando o banco). Valor é estimativa — o banco pode liberar diferente.
              </span>
            </div>
            {drawState?.error && <p className="mt-2 text-sm text-red-600">{drawState.error}</p>}
            {drawState?.ok && <p className="mt-2 text-sm text-emerald-700">✓ Draw requisitado — veja na aba Financiamento.</p>}
          </>
        )}
      </div>
    </section>
  );
}
