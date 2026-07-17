"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { addLoanEntry, addMonthlyInterest, type FormState } from "@/lib/actions/pool-loan";
import { ENTRY_TYPE_LABEL } from "@/lib/pools/loan-statement";

/**
 * Lançamentos em MODAL (pedido do Stefan 17/07): botão no topo da seção abre o modal —
 * a linha de formulário no rodapé da tabela foi aposentada.
 */

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";
const primaryBtn =
  "rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60";

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-slate-800">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

// ── "+ Lançar" do Statement: qualquer tipo de lançamento ──
export function LaunchEntryButton({
  poolId,
  loanId,
  houses,
}: {
  poolId: string;
  loanId: string;
  houses: Array<{ id: string; address: string }>;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addLoanEntry.bind(null, poolId),
    undefined,
  );
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-[#1f3a5f] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#16304f]"
      >
        + Lançar
      </button>
      {open && (
        <ModalShell title="Novo lançamento no statement" onClose={() => setOpen(false)}>
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="loanId" value={loanId} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Tipo</label>
                <select name="type" defaultValue="DRAW" className={inputClass}>
                  {Object.entries(ENTRY_TYPE_LABEL).map(([v, l]) => (
                    <option key={v} value={v}>
                      {l}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Data</label>
                <input name="date" type="date" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Valor (sempre positivo)</label>
                <input name="amount" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Casa (opcional)</label>
                <select name="houseId" defaultValue="" className={inputClass}>
                  <option value="">—</option>
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.address}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Memo</label>
                <input name="memo" className={inputClass} />
              </div>
            </div>
            <p className="text-[11px] text-slate-400">
              Payoff, pagamento de juro e crédito reduzem a dívida automaticamente.
            </p>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={pending} className={primaryBtn}>
                {pending ? "Lançando…" : "Lançar"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">
                Cancelar
              </button>
              {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
            </div>
          </form>
        </ModalShell>
      )}
    </>
  );
}

// ── "+ Lançar juro do mês" da aba Juros (com a opção "pago da interest reserve") ──
export function LaunchInterestButton({
  poolId,
  loanId,
  hasReserve,
}: {
  poolId: string;
  loanId: string;
  hasReserve: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addMonthlyInterest.bind(null, poolId),
    undefined,
  );
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-lg bg-[#1f3a5f] px-3.5 py-1.5 text-sm font-semibold text-white hover:bg-[#16304f]"
      >
        + Lançar juro do mês
      </button>
      {open && (
        <ModalShell title="Juro real do mês (extrato do banco)" onClose={() => setOpen(false)}>
          <form action={formAction} className="space-y-3">
            <input type="hidden" name="loanId" value={loanId} />
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Data (fim do mês)</label>
                <input name="date" type="date" required className={inputClass} />
              </div>
              <div>
                <label className={labelClass}>Juro cobrado $</label>
                <input name="amount" required className={inputClass} />
              </div>
              <div className="col-span-2">
                <label className={labelClass}>Memo</label>
                <input name="memo" placeholder="Juro do mês (extrato do banco)" className={inputClass} />
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="fromReserve" defaultChecked={hasReserve} /> pago da
              interest reserve (cria o pagamento espelhado — o saldo não compõe)
            </label>
            <div className="flex items-center gap-2">
              <button type="submit" disabled={pending} className={primaryBtn}>
                {pending ? "Lançando…" : "Lançar juro"}
              </button>
              <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">
                Cancelar
              </button>
              {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
            </div>
          </form>
        </ModalShell>
      )}
    </>
  );
}
