"use client";

import { useActionState } from "react";
import { addMonthlyInterest, type FormState } from "@/lib/actions/pool-loan";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

// Lançamento do juro real do mês, com a opção "pago da interest reserve" (padrão quando o
// banco tem reserve — cria o pagamento espelhado e o saldo não compõe).
export function AddMonthlyInterestForm({
  poolId,
  loanId,
  hasReserve,
}: {
  poolId: string;
  loanId: string;
  hasReserve: boolean;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addMonthlyInterest.bind(null, poolId),
    undefined,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="loanId" value={loanId} />
      <div className="w-40">
        <label className={labelClass}>Data (fim do mês)</label>
        <input name="date" type="date" required className={inputClass} />
      </div>
      <div className="w-36">
        <label className={labelClass}>Juro cobrado $</label>
        <input name="amount" required className={inputClass} />
      </div>
      <div className="min-w-40 flex-1">
        <label className={labelClass}>Memo</label>
        <input name="memo" placeholder="Juro do mês (extrato do banco)" className={inputClass} />
      </div>
      <label className="flex items-center gap-2 pb-2 text-sm text-slate-600">
        <input type="checkbox" name="fromReserve" defaultChecked={hasReserve} /> pago da interest
        reserve
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
      >
        {pending ? "Lançando…" : "+ Lançar juro"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
