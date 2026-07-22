"use client";

import { useState, useTransition } from "react";
import { useActionState } from "react";
import { saveInvestorLegacy, unlockInvestorLegacy, type LegacyFormState } from "@/lib/actions/investor-legacy";

/**
 * Histórico anterior do investidor (projetos encerrados) — SÓ ADMIN.
 * Lançamentos datados (data + tipo + valor + projeto) que entram na linha do tempo do
 * extrato. Travado depois de salvo: corrigir exige destravar explicitamente (auditado).
 */

export type LegacyRow = { date: string; kind: string; amount: number; label: string | null };
export type LegacyValues = { rows: LegacyRow[]; note: string | null; locked: boolean };

const KINDS: Array<{ v: string; label: string }> = [
  { v: "CONTRIBUTION", label: "Aporte" },
  { v: "DIST_CAPITAL", label: "Retorno de capital" },
  { v: "DIST_PROFIT", label: "Retorno de lucro" },
];
const kindLabel = (v: string) => KINDS.find((k) => k.v === v)?.label ?? v;
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const inp = "rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";

export function InvestorLegacyPanel({ entityKey, values }: { entityKey: string; values: LegacyValues }) {
  const [rows, setRows] = useState<LegacyRow[]>(values.rows);
  const [note, setNote] = useState(values.note ?? "");
  const [pending, start] = useTransition();
  const [state, setState] = useState<LegacyFormState>(undefined);
  const [unlockState, unlockAction, unlocking] = useActionState<LegacyFormState, FormData>(unlockInvestorLegacy, undefined);

  const set = (i: number, patch: Partial<LegacyRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { date: "", kind: "CONTRIBUTION", amount: 0, label: null }]);
  const del = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const totalIn = rows.filter((r) => r.kind === "CONTRIBUTION").reduce((s, r) => s + (Number(r.amount) || 0), 0);
  const totalOut = rows.filter((r) => r.kind !== "CONTRIBUTION").reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const save = (fd: FormData) => {
    fd.set("entityKey", entityKey);
    fd.set("rows", JSON.stringify(rows));
    fd.set("note", note);
    start(async () => setState(await saveInvestorLegacy(undefined, fd)));
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
          Histórico anterior — projetos encerrados
        </h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">só admin</span>
        {values.locked && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">🔒 travado</span>
        )}
        <span className="ml-auto text-[11px] text-slate-400">
          aportado {money(totalIn)} · devolvido {money(totalOut)}
        </span>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Lançamentos dos projetos que não entram no sistema. Cada um entra na linha do tempo do extrato pela data —
        a regra da carteira roda na ordem certa. <b>Não altera</b> TIR, NAV, units nem o valor projetado, que vêm dos
        fluxos dos pools atuais.
      </p>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[10px] uppercase tracking-wide text-slate-400">
              <th className="px-2 py-1.5 font-semibold">Data</th>
              <th className="px-2 py-1.5 font-semibold">Tipo</th>
              <th className="px-2 py-1.5 text-right font-semibold">Valor</th>
              <th className="px-2 py-1.5 font-semibold">Projeto</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="px-2 py-3 text-sm text-slate-400">Nenhum lançamento anterior.</td></tr>
            )}
            {rows.map((r, i) =>
              values.locked ? (
                <tr key={i} className="border-b border-slate-50 text-sm text-slate-700">
                  <td className="px-2 py-1.5 tabular-nums">{r.date}</td>
                  <td className="px-2 py-1.5">{kindLabel(r.kind)}</td>
                  <td className={`px-2 py-1.5 text-right tabular-nums ${r.kind === "CONTRIBUTION" ? "text-amber-700" : "text-emerald-700"}`}>
                    {r.kind === "CONTRIBUTION" ? "−" : "+"}{money(Number(r.amount))}
                  </td>
                  <td className="px-2 py-1.5 text-slate-500">{r.label ?? "—"}</td>
                  <td />
                </tr>
              ) : (
                <tr key={i} className="border-b border-slate-50">
                  <td className="px-2 py-1.5"><input type="date" value={r.date} onChange={(e) => set(i, { date: e.target.value })} className={`${inp} w-36`} /></td>
                  <td className="px-2 py-1.5">
                    <select value={r.kind} onChange={(e) => set(i, { kind: e.target.value })} className={`${inp} w-44`}>
                      {KINDS.map((k) => <option key={k.v} value={k.v}>{k.label}</option>)}
                    </select>
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <input value={r.amount || ""} onChange={(e) => set(i, { amount: Number(e.target.value) })} placeholder="50000" className={`${inp} w-28 text-right`} />
                  </td>
                  <td className="px-2 py-1.5"><input value={r.label ?? ""} onChange={(e) => set(i, { label: e.target.value })} placeholder="PH-1" className={`${inp} w-28`} /></td>
                  <td className="px-2 py-1.5"><button type="button" onClick={() => del(i)} className="text-xs text-slate-300 hover:text-red-500">✕</button></td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>

      {values.locked ? (
        <>
          {values.note && <p className="mt-2 text-[11.5px] text-slate-500">{values.note}</p>}
          <form action={unlockAction} className="mt-3 flex items-center gap-3">
            <input type="hidden" name="entityKey" value={entityKey} />
            <button type="submit" disabled={unlocking} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-400 disabled:opacity-50">
              {unlocking ? "Destravando…" : "Destravar para corrigir"}
            </button>
            <span className="text-[11px] text-slate-400">Fica registrado na auditoria quem destravou e alterou.</span>
          </form>
          {unlockState?.error && <p className="mt-2 text-sm text-red-600">{unlockState.error}</p>}
        </>
      ) : (
        <form action={save} className="mt-3">
          <div className="flex flex-wrap items-end gap-3">
            <button type="button" onClick={add} className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50">+ lançamento</button>
            <div className="min-w-[240px] flex-1">
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Observação (opcional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="reconstituído a partir dos extratos de 2023-24" className={`${inp} w-full`} />
            </div>
            <button type="submit" disabled={pending} className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-50">
              {pending ? "Salvando…" : "Salvar e travar"}
            </button>
          </div>
          {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
        </form>
      )}
    </section>
  );
}
