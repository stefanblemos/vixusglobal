"use client";

import { useRef, useState, useTransition } from "react";
import {
  applyBudgetToHouses,
  readBudgetDoc,
  saveHouseBudget,
  type BudgetReadResult,
  type MilestoneFormState,
} from "@/lib/actions/milestones";

// Gestão do budget do banco (Schedule of Values) POR CASA — leva 2/2b dos marcos (#73).
// Num loan multi-casa (ex.: FCI) cada casa tem seu orçamento. Duas frentes:
//   1) Leitor por IA: sobe um doc (PDF do banco ou planilha xlsx), a IA extrai as linhas e
//      mapeia aos nossos marcos; o operador confere e marca A QUAIS casas do loan aplicar.
//   2) Editor manual: escolhe uma casa e edita/ajusta o budget dela linha a linha.

export type BudgetRow = { label: string; pct: number; amount: number | null; milestoneKey: string | null };
export type MilestoneOption = { key: string; name: string };
export type BudgetHouse = { id: string; address: string; model: string | null; loanAmount: number; budget: BudgetRow[] };

const money = (n: number) => "US$" + Math.round(n).toLocaleString("en-US");
const input = "rounded border border-slate-200 px-2 py-1 text-sm";

export function HouseBudgetManager({
  loanId,
  houses,
  milestones,
  retainagePct,
  expectedDraws,
}: {
  loanId: string;
  houses: BudgetHouse[];
  milestones: MilestoneOption[];
  retainagePct: string;
  expectedDraws: string;
}) {
  const mName = (k: string | null) => milestones.find((m) => m.key === k)?.name;
  return (
    <div className="space-y-4">
      <BudgetReader loanId={loanId} houses={houses} milestones={milestones} retainagePct={retainagePct} expectedDraws={expectedDraws} mName={mName} />
      <ManualBudget houses={houses} milestones={milestones} retainagePct={retainagePct} expectedDraws={expectedDraws} />
    </div>
  );
}

// ── 1) Leitor por IA ──────────────────────────────────────────────────
function BudgetReader({
  loanId,
  houses,
  milestones,
  retainagePct,
  expectedDraws,
  mName,
}: {
  loanId: string;
  houses: BudgetHouse[];
  milestones: MilestoneOption[];
  retainagePct: string;
  expectedDraws: string;
  mName: (k: string | null) => string | undefined;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const [prop, setProp] = useState<Extract<BudgetReadResult, { ok: true }> | null>(null);
  const [rows, setRows] = useState<BudgetRow[]>([]);
  const [ret, setRet] = useState(retainagePct);
  const [draws, setDraws] = useState(expectedDraws);
  const [applyIds, setApplyIds] = useState<Set<string>>(new Set());
  const [applyState, setApplyState] = useState<MilestoneFormState>(undefined);

  const total = prop?.total ?? rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const set = (i: number, patch: Partial<BudgetRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const del = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const read = () => {
    const f = fileRef.current?.files?.[0];
    if (!f) { setErr("Escolha um arquivo primeiro."); return; }
    setErr(null); setApplyState(undefined);
    const fd = new FormData();
    fd.set("file", f);
    start(async () => {
      const r = await readBudgetDoc(fd);
      if ("error" in r) { setErr(r.error); setProp(null); return; }
      setProp(r);
      setRows(r.rows);
      if (r.retainagePct != null) setRet(String(r.retainagePct));
      if (r.expectedDraws != null) setDraws(String(r.expectedDraws));
      setApplyIds(new Set(houses.length === 1 ? [houses[0].id] : []));
    });
  };

  const apply = () => {
    setApplyState(undefined);
    const fd = new FormData();
    fd.set("loanId", loanId);
    fd.set("houseIds", JSON.stringify([...applyIds]));
    fd.set("rows", JSON.stringify(rows.map((r) => ({ label: r.label, pct: r.pct, amount: r.amount, milestoneKey: r.milestoneKey }))));
    fd.set("source", "AI");
    fd.set("retainagePct", ret);
    fd.set("expectedDraws", draws);
    start(async () => {
      const r = await applyBudgetToHouses(undefined, fd);
      setApplyState(r);
      if (r?.ok) { setProp(null); setRows([]); setApplyIds(new Set()); if (fileRef.current) fileRef.current.value = ""; }
    });
  };

  const toggleHouse = (id: string) =>
    setApplyIds((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const mapped = rows.filter((r) => r.milestoneKey).length;

  return (
    <section className="rounded-xl border border-[#1f3a5f]/20 bg-[#f6f8fb] p-4">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
        <span>📄</span> Ler budget do banco por IA
      </h3>
      <p className="mt-1 mb-3 text-xs text-slate-500">
        Suba o budget do banco (PDF do draw schedule ou planilha .xlsx/.xlsm). A IA lê as linhas, mapeia aos nossos
        marcos e monta uma proposta — você confere e escolhe a quais casas deste financiamento aplicar.
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xlsm,.xls" className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-[#1f3a5f] file:px-3 file:py-1.5 file:text-white" />
        <button type="button" onClick={read} disabled={pending} className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-40">
          {pending && !prop ? "Lendo…" : "Ler documento"}
        </button>
      </div>
      {err && <p className="mt-2 text-sm text-red-600">{err}</p>}

      {prop && (
        <div className="mt-4 rounded-xl border border-slate-200 bg-white p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-semibold text-[#1f3a5f]">Proposta da IA — confira e ajuste</p>
              {prop.summary && <p className="text-xs text-slate-400">{prop.summary}</p>}
            </div>
            <span className="text-[11px] text-slate-400">{mapped}/{rows.length} mapeados · total {money(total)}</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-1.5 font-medium">Linha do banco</th>
                  <th className="px-2 py-1.5 text-right font-medium">Valor</th>
                  <th className="px-2 py-1.5 text-right font-medium">% do total</th>
                  <th className="px-2 py-1.5 font-medium">Marco nosso</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} className={`border-t border-slate-50 ${!r.milestoneKey ? "bg-amber-50/40" : ""}`}>
                    <td className="px-2 py-1.5"><input className={`${input} w-full`} value={r.label} onChange={(e) => set(i, { label: e.target.value })} /></td>
                    <td className="px-2 py-1.5 text-right text-slate-500">{r.amount != null ? money(r.amount) : "—"}</td>
                    <td className="px-2 py-1.5 text-right"><input type="number" step="0.1" min="0" className={`${input} w-20 text-right`} value={r.pct} onChange={(e) => set(i, { pct: Number(e.target.value) })} /></td>
                    <td className="px-2 py-1.5">
                      <select className={`${input} w-full ${!r.milestoneKey ? "border-amber-300 text-amber-700" : ""}`} value={r.milestoneKey ?? ""} onChange={(e) => set(i, { milestoneKey: e.target.value || null })}>
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
            <div>
              <label className="block text-[11px] font-medium text-slate-500">Retainage % (do LOI/contrato)</label>
              <input type="number" step="0.5" min="0" value={ret} onChange={(e) => setRet(e.target.value)} className={`${input} w-24`} placeholder="ex.: 10" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500">Nº de draws esperado</label>
              <input type="number" min="0" value={draws} onChange={(e) => setDraws(e.target.value)} className={`${input} w-24`} placeholder="ex.: 9" />
            </div>
          </div>

          {/* a quais casas aplicar */}
          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-[#1f3a5f]">Aplicar este orçamento a quais casas?</p>
            <p className="mb-2 text-[11px] text-slate-400">
              Marque as casas deste financiamento que usam este budget (mesmo modelo/valor). As demais mantêm as regras do
              loan e recebem o próprio orçamento quando a planilha delas chegar.
            </p>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {houses.map((h) => (
                <label key={h.id} className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm hover:bg-slate-100">
                  <input type="checkbox" checked={applyIds.has(h.id)} onChange={() => toggleHouse(h.id)} className="h-4 w-4 accent-[#1f3a5f]" />
                  <span className="flex-1">
                    <span className="font-medium text-slate-700">{h.address}</span>
                    <small className="block text-[11px] text-slate-400">
                      {h.model ?? "modelo —"} · loan {money(h.loanAmount)}
                      {h.budget.length > 0 && <span className="text-amber-600"> · já tem budget (substitui)</span>}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="mt-3 flex items-center gap-3">
            <button type="button" onClick={apply} disabled={pending || applyIds.size === 0} className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-40">
              {pending ? "Aplicando…" : `Aplicar a ${applyIds.size} casa(s)`}
            </button>
            <button type="button" onClick={() => { setProp(null); setRows([]); }} className="text-xs text-slate-400 hover:text-slate-600">descartar</button>
          </div>
          {applyState?.error && <p className="mt-2 text-sm text-red-600">{applyState.error}</p>}
        </div>
      )}
      {applyState?.ok && <p className="mt-2 text-sm text-emerald-700">✓ {applyState.message ?? "Orçamento aplicado."}</p>}
    </section>
  );
}

// ── 2) Editor manual por casa ─────────────────────────────────────────
function ManualBudget({
  houses,
  milestones,
  retainagePct,
  expectedDraws,
}: {
  houses: BudgetHouse[];
  milestones: MilestoneOption[];
  retainagePct: string;
  expectedDraws: string;
}) {
  const [sel, setSel] = useState(houses[0]?.id ?? "");
  const house = houses.find((h) => h.id === sel);
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Budget por casa (manual)</h3>
        <select value={sel} onChange={(e) => setSel(e.target.value)} className={`${input}`}>
          {houses.map((h) => (
            <option key={h.id} value={h.id}>{h.address}{h.budget.length ? ` (${h.budget.length})` : " — sem budget"}</option>
          ))}
        </select>
      </div>
      {house ? (
        <ManualHouseForm key={house.id} house={house} milestones={milestones} retainagePct={retainagePct} expectedDraws={expectedDraws} />
      ) : (
        <p className="text-sm text-slate-400">Vincule casas a este financiamento (aba Casas) para editar o budget.</p>
      )}
    </section>
  );
}

function ManualHouseForm({
  house,
  milestones,
  retainagePct,
  expectedDraws,
}: {
  house: BudgetHouse;
  milestones: MilestoneOption[];
  retainagePct: string;
  expectedDraws: string;
}) {
  const [rows, setRows] = useState<BudgetRow[]>(house.budget);
  const [pending, start] = useTransition();
  const [state, setState] = useState<MilestoneFormState>(undefined);

  const sum = Math.round(rows.reduce((s, r) => s + (Number(r.pct) || 0), 0) * 10) / 10;
  const mapped = rows.filter((r) => r.milestoneKey).length;
  const set = (i: number, patch: Partial<BudgetRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const add = () => setRows((rs) => [...rs, { label: "", pct: 0, amount: null, milestoneKey: null }]);
  const del = (i: number) => setRows((rs) => rs.filter((_, j) => j !== i));

  const save = (fd: FormData) => {
    fd.set("houseId", house.id);
    fd.set("rows", JSON.stringify(rows));
    start(async () => setState(await saveHouseBudget(undefined, fd)));
  };

  return (
    <form action={save}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-slate-400">loan {money(house.loanAmount)}</span>
        <span className="text-[11px] text-slate-400">{mapped}/{rows.length} mapeados · soma {sum}%</span>
      </div>
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
            {rows.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-sm text-slate-400">Sem budget — use o leitor acima ou adicione linhas.</td></tr>}
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
          <label className="block text-[11px] font-medium text-slate-500">Retainage % (do loan)</label>
          <input name="retainagePct" type="number" step="0.5" min="0" defaultValue={retainagePct} className={`${input} w-24`} placeholder="ex.: 10" />
        </div>
        <div>
          <label className="block text-[11px] font-medium text-slate-500">Nº de draws esperado</label>
          <input name="expectedDraws" type="number" min="0" defaultValue={expectedDraws} className={`${input} w-24`} placeholder="ex.: 9" />
        </div>
        <button type="submit" disabled={pending} className="ml-auto rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-40">
          {pending ? "Salvando…" : "Salvar budget da casa"}
        </button>
      </div>
      {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="mt-2 text-sm text-emerald-700">✓ Budget salvo.</p>}
    </form>
  );
}
