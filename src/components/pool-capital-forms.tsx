"use client";

import { useActionState } from "react";
import { addChangeOrder, createCapitalCall, type FormState } from "@/lib/actions/pools";

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
        <input name="amount" required placeholder="negativo = crédito" className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Adding…" : "+ Change order"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

// Chamada de capital pro rata às units.
export function CreateCapitalCallForm({
  poolId,
  suggestedAmount,
}: {
  poolId: string;
  suggestedAmount: string | null; // shortfall calculado (custos+COs − captado), se houver
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    createCapitalCall.bind(null, poolId),
    undefined,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="w-40">
        <label className={labelClass}>Data da chamada</label>
        <input name="date" type="date" required className={inputClass} />
      </div>
      <div className="w-36">
        <label className={labelClass}>Total $</label>
        <input name="totalAmount" required defaultValue={suggestedAmount ?? ""} className={inputClass} />
      </div>
      <div className="min-w-56 flex-1">
        <label className={labelClass}>Motivo</label>
        <input name="reason" required placeholder="Change orders + juros sem reserve" className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Gerando…" : "+ Capital call"}
      </button>
      <p className="w-full text-xs text-slate-400">
        O rateio é pro rata às units na data; o relatório abre em seguida para envio aos sócios.
        Cada recebimento registrado vira aporte e aumenta a base de retorno do investidor.
      </p>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
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
