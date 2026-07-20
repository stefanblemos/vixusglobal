"use client";

import { useActionState, useState } from "react";
import { saveLoanBudget, type MilestoneFormState } from "@/lib/actions/milestones";

// Editor do Schedule of Values / budget do banco (leva 2 dos marcos). Cada linha = uma
// fase do budget do banco com % do loan e o MARCO nosso a que corresponde. Marcar o marco
// na casa libera o % das linhas mapeadas → drawable REAL (em vez da estimativa por peso).

export type BudgetRow = { label: string; pct: number; milestoneKey: string | null };
export type MilestoneOption = { key: string; name: string };

export function LoanBudgetEditor({
  loanId,
  initial,
  milestones,
  retainagePct,
  expectedDraws,
}: {
  loanId: string;
  initial: BudgetRow[];
  milestones: MilestoneOption[];
  retainagePct: string;
  expectedDraws: string;
}) {
  const [rows, setRows] = useState<BudgetRow[]>(initial);
  const [state, action, pending] = useActionState<MilestoneFormState, FormData>(saveLoanBudget, undefined);

  const sum = Math.round(rows.reduce((s, r) => s + (Number(r.pct) || 0), 0) * 10) / 10;
  const mapped = rows.filter((r) => r.milestoneKey).length;
  const set = (i: number, patch: Partial<BudgetRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { label: "", pct: 0, milestoneKey: null }]);
  const del = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const input = "rounded border border-slate-200 px-2 py-1 text-sm";

  return (
    <form action={action} className="rounded-xl border border-slate-200 bg-white p-4">
      <input type="hidden" name="loanId" value={loanId} />
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <div className="mb-1 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Budget do banco (Schedule of Values)</h3>
        <span className="text-[11px] text-slate-400">{mapped}/{rows.length} mapeados · soma {sum}%</span>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        As linhas do draw schedule do banco, cada uma com o % do loan que libera e o marco nosso correspondente.
        Marcar o marco na casa libera esse % (drawable real). Não precisa somar 100 — o banco pode reter ou ter itens não-obra.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-2 py-1.5 font-medium">Linha do banco</th>
              <th className="px-2 py-1.5 text-right font-medium">% do loan</th>
              <th className="px-2 py-1.5 font-medium">Marco nosso</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={4} className="px-2 py-3 text-sm text-slate-400">Nenhuma linha — adicione as fases do draw schedule do banco.</td></tr>
            )}
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-50">
                <td className="px-2 py-1.5"><input className={`${input} w-full`} value={r.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="ex.: Foundation" /></td>
                <td className="px-2 py-1.5 text-right"><input type="number" step="0.5" min="0" className={`${input} w-20 text-right`} value={r.pct} onChange={(e) => set(i, { pct: Number(e.target.value) })} /></td>
                <td className="px-2 py-1.5">
                  <select className={`${input} w-full`} value={r.milestoneKey ?? ""} onChange={(e) => set(i, { milestoneKey: e.target.value || null })}>
                    <option value="">— não mapeado —</option>
                    {milestones.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}
                  </select>
                </td>
                <td className="px-2 py-1.5"><button type="button" onClick={() => del(i)} className="text-xs text-slate-300 hover:text-red-500">✕</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-4">
        <button type="button" onClick={add} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">+ linha</button>
        <div>
          <label className="block text-[11px] font-medium text-slate-500">Retainage % (do LOI/contrato)</label>
          <input name="retainagePct" type="number" step="0.5" min="0" defaultValue={retainagePct} className={`${input} w-24`} placeholder="ex.: 10" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500">Nº de draws esperado</label>
          <input name="expectedDraws" type="number" min="0" defaultValue={expectedDraws} className={`${input} w-24`} placeholder="ex.: 6" />
        </div>
        <button type="submit" disabled={pending} className="ml-auto rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-40">
          {pending ? "Salvando…" : "Salvar budget"}
        </button>
      </div>
      {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="mt-2 text-sm text-emerald-700">✓ Budget salvo.</p>}
    </form>
  );
}
