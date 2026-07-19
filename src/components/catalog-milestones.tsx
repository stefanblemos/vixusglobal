"use client";

import { useActionState, useState } from "react";
import { saveMilestoneCatalog, type MilestoneFormState } from "@/lib/actions/milestones";

// Editor do catálogo de marcos de construção (#73) — fases + pesos (somam 100), editáveis.
// Os pesos valem para todas as casas; cada casa marca só quais fases concluiu.

export type MilestoneCatalogRow = { key: string; name: string; detail: string; weightPct: number };

export function CatalogMilestones({ initial }: { initial: MilestoneCatalogRow[] }) {
  const [rows, setRows] = useState<MilestoneCatalogRow[]>(initial);
  const [state, action, pending] = useActionState<MilestoneFormState, FormData>(saveMilestoneCatalog, undefined);

  const sum = Math.round(rows.reduce((s, r) => s + (Number(r.weightPct) || 0), 0) * 100) / 100;
  const set = (i: number, patch: Partial<MilestoneCatalogRow>) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { key: `phase${rs.length + 1}`, name: "", detail: "", weightPct: 0 }]);
  const del = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const input = "rounded border border-slate-200 px-2 py-1 text-sm";

  return (
    <form action={action}>
      <input type="hidden" name="rows" value={JSON.stringify(rows)} />
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-2 py-1.5 font-medium">Fase</th>
              <th className="px-2 py-1.5 font-medium">Detalhe</th>
              <th className="px-2 py-1.5 text-right font-medium">Peso %</th>
              <th className="px-2 py-1.5 font-medium">Chave</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="border-t border-slate-50">
                <td className="px-2 py-1.5">
                  <input className={`${input} w-full`} value={r.name} onChange={(e) => set(i, { name: e.target.value })} placeholder="Nome da fase" />
                </td>
                <td className="px-2 py-1.5">
                  <input className={`${input} w-full`} value={r.detail} onChange={(e) => set(i, { detail: e.target.value })} placeholder="opcional" />
                </td>
                <td className="px-2 py-1.5 text-right">
                  <input
                    type="number"
                    step="0.5"
                    min="0"
                    className={`${input} w-20 text-right`}
                    value={r.weightPct}
                    onChange={(e) => set(i, { weightPct: Number(e.target.value) })}
                  />
                </td>
                <td className="px-2 py-1.5">
                  <input className={`${input} w-24 font-mono text-xs`} value={r.key} onChange={(e) => set(i, { key: e.target.value.trim() })} />
                </td>
                <td className="px-2 py-1.5">
                  <button type="button" onClick={() => del(i)} className="text-xs text-slate-300 hover:text-red-500">✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button type="button" onClick={add} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
          + fase
        </button>
        <span className={`text-sm font-semibold ${sum === 100 ? "text-emerald-700" : "text-amber-700"}`}>
          Soma: {sum}% {sum === 100 ? "✓" : "(precisa ser 100%)"}
        </span>
        <button
          type="submit"
          disabled={pending || sum !== 100}
          className="ml-auto rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-40"
        >
          {pending ? "Salvando…" : "Salvar marcos"}
        </button>
      </div>
      {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="mt-2 text-sm text-emerald-700">✓ Catálogo de marcos salvo.</p>}
    </form>
  );
}
