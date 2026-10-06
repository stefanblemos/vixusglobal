"use client";

import { useActionState, useState } from "react";
import {
  addChangeOrder,
  addPoolExpense,
  createCapitalCall,
  type FormState,
} from "@/lib/actions/pools";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const buttonClass =
  "rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60";

// Change order da casa (CO): despesa/crédito que altera o valor do contrato.
export function AddChangeOrderForm({ houseId }: { houseId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addChangeOrder.bind(null, houseId),
    undefined,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="w-40">
        <label className={labelClass}>Data</label>
        <input name="date" type="date" required className={inputClass} />
      </div>
      <div className="min-w-56 flex-1">
        <label className={labelClass}>Descrição</label>
        <input name="description" required placeholder="CO #3 — upgrade de bancada" className={inputClass} />
      </div>
      <div className="w-32">
        <label className={labelClass}>Valor $</label>
        <input name="amount" required className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Adding…" : "+ Change order"}
      </button>
      <p className="w-full text-xs text-slate-400">
        Positivo = CO (aumenta o valor do contrato/custo da obra); negativo = desconto (reduz o
        contrato).
      </p>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

const EXPENSE_CATEGORIES = [
  ["FORMATION", "Abertura da LLC"],
  ["ANNUAL_REPORT", "Annual report"],
  ["TAX_PREP", "IR / K-1s"],
  ["ACCOUNTING", "Contabilidade"],
  // Fase 4: provisão de encerramento da SPV — enquanto não existir, a projeção líquida
  // usa a estimativa padrão ($2.5K) com selo "estimado"
  ["DISSOLUTION", "Encerramento da SPV (dissolução + 1065 final)"],
  ["OTHER", "Outra"],
] as const;

const INCOME_CATEGORIES = [
  ["LENDER_CREDIT", "Crédito do lender"],
  ["REFUND", "Reembolso / estorno"],
  ["BANK_INTEREST", "Juros de conta"],
  ["OTHER_INCOME", "Outra receita"],
] as const;

// Despesa do PRÓPRIO pool (não das casas) — provisionada ou paga. Ou RECEITA do pool (06/10):
// crédito do lender, reembolso, juros de conta — entra no caixa e no lucro, não é aporte.
// Dois botões explícitos — "+ Despesa" e "+ Receita" — cada um abre o form já no modo certo
// (pedido do Stefan 06/10: o modo escondido dentro do form confundia o operador).
export function PoolExpenseLauncher({ poolId }: { poolId: string }) {
  const [open, setOpen] = useState<"OUT" | "IN" | null>(null);
  const btn = (d: "OUT" | "IN", label: string) => (
    <button
      type="button"
      onClick={() => setOpen((o) => (o === d ? null : d))}
      className={`rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition ${
        open === d ? "border-[#1f3a5f] bg-blue-50 text-[#1f3a5f]" : d === "IN" ? "border-emerald-300 text-emerald-700 hover:bg-emerald-50" : "border-slate-300 text-slate-600 hover:bg-slate-50"
      }`}
    >
      {label}
    </button>
  );
  return (
    <div className="w-full">
      <div className="flex justify-end gap-2">
        {btn("OUT", "+ Despesa")}
        {btn("IN", "+ Receita")}
      </div>
      {open && (
        <div className="mt-3 rounded-lg border border-blue-100 bg-slate-50 p-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#1f3a5f]">
            {open === "IN" ? "Nova receita do pool" : "Nova despesa do pool"}
          </div>
          <AddPoolExpenseForm key={open} poolId={poolId} direction={open} onDone={() => setOpen(null)} />
        </div>
      )}
    </div>
  );
}

export function AddPoolExpenseForm({ poolId, direction = "OUT", onDone }: { poolId: string; direction?: "OUT" | "IN"; onDone?: () => void }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (prev: FormState, fd: FormData) => {
      const r = await addPoolExpense(poolId, prev, fd);
      if (!r?.error) onDone?.();
      return r;
    },
    undefined,
  );
  const income = direction === "IN";
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="direction" value={direction} />
      <div className="w-40">
        <label className={labelClass}>Data</label>
        <input name="date" type="date" required className={inputClass} />
      </div>
      <div className="w-44">
        <label className={labelClass}>Categoria</label>
        <select key={direction} name="category" defaultValue={income ? "LENDER_CREDIT" : "TAX_PREP"} className={inputClass}>
          {(income ? INCOME_CATEGORIES : EXPENSE_CATEGORIES).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-48 flex-1">
        <label className={labelClass}>Descrição</label>
        <input name="description" required placeholder="1065 + K-1s 2026 (contador)" className={inputClass} />
      </div>
      <div className="w-28">
        <label className={labelClass}>Valor $</label>
        <input name="amount" required className={inputClass} />
      </div>
      {!income && (
        <div className="w-36">
          <label className={labelClass}>Status</label>
          <select name="status" defaultValue="PROVISIONED" className={inputClass}>
            <option value="PROVISIONED">Provisionada</option>
            <option value="PAID">Paga</option>
          </select>
        </div>
      )}
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Lançando…" : income ? "+ Receita" : "+ Despesa"}
      </button>
      {income && (
        <p className="w-full text-xs text-slate-400">
          Dinheiro que ENTROU na conta do pool sem ser aporte nem venda (ex.: crédito do lender, reembolso).
          Soma ao caixa e ao lucro distribuível; não emite units.
        </p>
      )}
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export type CallMember = { id: string; name: string; role: "MANAGER" | "INVESTOR"; units: number };

const f2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const f4 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 4 });
const parseAmt = (s: string) => {
  const n = Number(s.replace(/[,$\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// Chamada de capital (mock aprovado 05/10): rateio pelo % ATUAL, prévia viva por sócio com
// "recebido" editável (integral / parcial / não participa / cobriu diferença), units novas e
// % depois. Pode emitir só a chamada (todos pendentes) ou já registrar os recebimentos.
export function CreateCapitalCallForm({
  poolId,
  members,
  unitPrice,
  suggestedAmount,
}: {
  poolId: string;
  members: CallMember[];
  unitPrice: number;
  suggestedAmount: string | null; // shortfall calculado (custos+COs − captado), se houver
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createCapitalCall.bind(null, poolId),
    undefined,
  );
  const [total, setTotal] = useState(suggestedAmount ?? "");
  const [registerNow, setRegisterNow] = useState(false);
  // null = recebe o pro rata; número = valor digitado/ajustado
  const [received, setReceived] = useState<Record<string, number | null>>({});

  const active = members.filter((m) => m.units > 0);
  const totU = active.reduce((s, m) => s + m.units, 0);
  const t = parseAmt(total);
  // mesma regra do server: 2 casas, resíduo de centavos na maior posição
  const pro = active.map((m) => Math.round(((t * m.units) / totU) * 100) / 100);
  const residue = Math.round((t - pro.reduce((s, v) => s + v, 0)) * 100) / 100;
  if (residue && pro.length) {
    const i = pro.indexOf(Math.max(...pro));
    pro[i] = Math.round((pro[i] + residue) * 100) / 100;
  }
  const rec = active.map((m, i) => (received[m.id] == null ? pro[i] : received[m.id]!));
  const sumRec = rec.reduce((s, v) => s + v, 0);
  const newU = rec.map((v) => v / unitPrice);
  const totAfter = totU + newU.reduce((s, v) => s + v, 0);
  const gap = Math.round((t - sumRec) * 100) / 100;
  const pct = (n: number) => n.toFixed(2) + "%";

  const setRec = (id: string, v: number | null) => setReceived((r) => ({ ...r, [id]: v }));
  const cover = (id: string) => {
    const i = active.findIndex((m) => m.id === id);
    setRec(id, Math.round((rec[i] + gap) * 100) / 100);
  };
  const manager = active.find((m) => m.role === "MANAGER") ?? active[0];

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="registerNow" value={registerNow ? "1" : "0"} />
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-40">
          <label className={labelClass}>Data da chamada</label>
          <input name="date" type="date" required className={inputClass} />
        </div>
        <div className="w-36">
          <label className={labelClass}>Total $</label>
          <input name="totalAmount" required value={total} onChange={(e) => setTotal(e.target.value)} className={inputClass} />
        </div>
        <div className="min-w-56 flex-1">
          <label className={labelClass}>Motivo</label>
          <input name="reason" required placeholder="Change orders + juros sem reserve" className={inputClass} />
        </div>
      </div>
      <p className="text-xs text-slate-400">
        Rateio pelo <b>% atual</b> (units de cada sócio hoje). Quem receber mais que o pro rata dilui os
        demais — vale também sobre o lucro das casas já vendidas. Aporte de chamada não tem regra de
        múltiplo de $1.000 (essa fica na captação).
      </p>

      <label className="flex items-center gap-2 text-sm text-slate-700">
        <input type="checkbox" checked={registerNow} onChange={(e) => setRegisterNow(e.target.checked)} />
        O dinheiro já entrou — registrar os recebimentos junto com a emissão
      </label>

      {t > 0 && active.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100 text-left text-[10.5px] uppercase tracking-wider text-slate-400">
                <th className="px-3 py-2 font-medium">Sócio</th>
                <th className="px-2 py-2 text-right font-medium">% atual</th>
                <th className="px-2 py-2 text-right font-medium">Pro rata</th>
                {registerNow && (
                  <>
                    <th className="px-2 py-2 text-right font-medium">Recebido</th>
                    <th className="px-2 py-2 font-medium"></th>
                    <th className="px-2 py-2 text-right font-medium">Units novas</th>
                    <th className="px-2 py-2 text-right font-medium">% depois</th>
                    <th className="px-2 py-2 text-right font-medium">Δ</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody className="text-[13px]">
              {active.map((m, i) => {
                const before = (m.units / totU) * 100;
                const after = ((m.units + newU[i]) / totAfter) * 100;
                const d = after - before;
                const diffPro = rec[i] - pro[i];
                const status =
                  rec[i] === 0 ? ["não participa", "bg-red-50 text-red-700"]
                  : Math.abs(diffPro) < 0.005 ? ["integral", "bg-emerald-50 text-emerald-700"]
                  : diffPro < 0 ? ["parcial", "bg-amber-50 text-amber-700"]
                  : ["cobriu diferença", "bg-blue-50 text-[#1f3a5f]"];
                return (
                  <tr key={m.id} className="border-b border-slate-50">
                    <td className="px-3 py-1.5 text-slate-700">
                      {m.name}{m.role === "MANAGER" && <span className="ml-1 rounded-full bg-blue-50 px-1.5 text-[10px] font-semibold text-[#1f3a5f]">Manager</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-slate-500">{pct(before)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{f2(pro[i])}</td>
                    {registerNow && (
                      <>
                        <td className="px-2 py-1.5 text-right">
                          <input
                            name={`received:${m.id}`}
                            value={f2(rec[i])}
                            onChange={(e) => setRec(m.id, parseAmt(e.target.value))}
                            className={`w-28 rounded border px-2 py-1 text-right text-[13px] tabular-nums outline-none focus:border-[#1f3a5f] ${
                              Math.abs(diffPro) >= 0.005 ? "border-amber-400 bg-amber-50" : "border-slate-300"
                            }`}
                          />
                        </td>
                        <td className="whitespace-nowrap px-2 py-1.5">
                          <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${status[1]}`}>{status[0]}</span>
                          <button type="button" onClick={() => setRec(m.id, 0)} className="ml-1 rounded border border-slate-300 px-1.5 text-[10.5px] text-slate-500 hover:bg-slate-50">não participa</button>
                          <button type="button" onClick={() => setRec(m.id, null)} className="ml-1 rounded border border-slate-300 px-1.5 text-[10.5px] text-slate-500 hover:bg-slate-50">integral</button>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{newU[i] ? f4(newU[i]) : "—"}</td>
                        <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{pct(after)}</td>
                        <td className={`px-2 py-1.5 text-right tabular-nums ${d > 0.005 ? "text-emerald-700" : d < -0.005 ? "text-red-700" : "text-slate-400"}`}>
                          {d > 0.005 ? "+" : ""}{d.toFixed(2)} pp
                        </td>
                      </>
                    )}
                  </tr>
                );
              })}
              <tr className="bg-slate-50 font-semibold">
                <td className="px-3 py-1.5">Total</td>
                <td className="px-2 py-1.5 text-right">100%</td>
                <td className="px-2 py-1.5 text-right tabular-nums">{f2(t)}</td>
                {registerNow && (
                  <>
                    <td className="px-2 py-1.5 text-right tabular-nums">{f2(sumRec)}</td>
                    <td></td>
                    <td className="px-2 py-1.5 text-right tabular-nums">{f4(sumRec / unitPrice)}</td>
                    <td className="px-2 py-1.5 text-right">100%</td>
                    <td></td>
                  </>
                )}
              </tr>
            </tbody>
          </table>
          {registerNow && (
            <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-xs ${Math.abs(gap) < 0.005 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
              {Math.abs(gap) < 0.005 ? (
                <span>✓ Recebido fecha com o total chamado.</span>
              ) : gap > 0 ? (
                <>
                  <span>Faltam <b>{f2(gap)}</b> para fechar a chamada.</span>
                  <span className="flex items-center gap-1">
                    {manager && (
                      <button type="button" onClick={() => cover(manager.id)} className="rounded border border-[#1f3a5f] bg-white px-2 py-0.5 font-semibold text-[#1f3a5f] hover:bg-blue-50">
                        {manager.name} cobre a diferença
                      </button>
                    )}
                    <span className="text-amber-700">· ou emita assim e o restante fica pendente</span>
                  </span>
                </>
              ) : (
                <span>Recebido passa do chamado em <b>{f2(-gap)}</b> — ajuste o total ou os recebidos.</span>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending || t <= 0} className={buttonClass}>
          {pending ? "Gerando…" : registerNow ? "Emitir chamada e registrar recebimentos" : "Emitir chamada (todos pendentes)"}
        </button>
        <span className="text-xs text-slate-400">O relatório abre em seguida para envio aos sócios; recebimentos pendentes são registrados lá, um a um, com a data do wire.</span>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 print:hidden"
    >
      🖨 Imprimir / PDF
    </button>
  );
}
