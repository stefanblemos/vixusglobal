"use client";

import { useActionState } from "react";
import { addLoanEntry, savePoolLoan, type FormState } from "@/lib/actions/pool-loan";
import { ENTRY_TYPE_LABEL } from "@/lib/pools/loan-statement";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const buttonClass =
  "rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60";

export function PoolLoanTermsForm({
  poolId,
  loanId,
  banks,
  loan,
}: {
  poolId: string;
  loanId: string | null; // null = criar um loan novo
  banks: Array<{ id: string; name: string }>;
  loan: {
    bankProfileId: string | null;
    loanNumber: string | null;
    committed: string | null;
    aprPct: string | null;
    expectedClosingDate: string | null; // yyyy-mm-dd
    closingDate: string | null; // yyyy-mm-dd
    notes: string | null;
  } | null;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    savePoolLoan.bind(null, poolId),
    undefined,
  );
  return (
    // key = valores atuais: o form fica montado após o save ("Saved.") e o React 19 reseta
    // os inputs para o defaultValue de montagem — a remontagem realinha com o banco
    <form key={JSON.stringify(loan)} action={formAction} className="flex flex-wrap items-end gap-3">
      {loanId && <input type="hidden" name="loanId" value={loanId} />}
      <div className="w-56">
        <label className={labelClass}>Banco</label>
        <select name="bankProfileId" defaultValue={loan?.bankProfileId ?? ""} className={inputClass}>
          <option value="">—</option>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>
      <div className="w-28">
        <label className={labelClass}>Loan #</label>
        <input name="loanNumber" defaultValue={loan?.loanNumber ?? ""} className={inputClass} />
      </div>
      <div className="w-36">
        <label className={labelClass}>Comprometido</label>
        <input name="committed" defaultValue={loan?.committed ?? ""} className={inputClass} />
      </div>
      <div className="w-24">
        <label className={labelClass}>APR %</label>
        <input name="aprPct" defaultValue={loan?.aprPct ?? ""} className={inputClass} />
      </div>
      <div className="w-40">
        <label className={labelClass}>Closing previsto</label>
        <input
          name="expectedClosingDate"
          type="date"
          defaultValue={loan?.expectedClosingDate ?? ""}
          className={inputClass}
        />
      </div>
      <div className="w-40">
        <label className={labelClass}>Closing real</label>
        <input name="closingDate" type="date" defaultValue={loan?.closingDate ?? ""} className={inputClass} />
      </div>
      <div className="min-w-40 flex-1">
        <label className={labelClass}>Notas</label>
        <input name="notes" defaultValue={loan?.notes ?? ""} className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Saving…" : loan ? "Save terms" : "Create loan"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      {state?.ok && <p className="w-full text-xs text-emerald-600">Saved.</p>}
    </form>
  );
}

export function AddLoanEntryForm({
  poolId,
  loanId,
  houses,
}: {
  poolId: string;
  loanId: string;
  houses: Array<{ id: string; address: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addLoanEntry.bind(null, poolId),
    undefined,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="loanId" value={loanId} />
      <div className="w-52">
        <label className={labelClass}>Tipo</label>
        <select name="type" defaultValue="DRAW" className={inputClass}>
          {Object.entries(ENTRY_TYPE_LABEL).map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>
      <div className="w-40">
        <label className={labelClass}>Data</label>
        <input name="date" type="date" required className={inputClass} />
      </div>
      <div className="w-32">
        <label className={labelClass}>Valor</label>
        <input name="amount" required placeholder="sempre positivo" className={inputClass} />
      </div>
      <div className="min-w-48 flex-1">
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
      <div className="min-w-40 flex-1">
        <label className={labelClass}>Memo</label>
        <input name="memo" className={inputClass} />
      </div>
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "Adding…" : "+ Lançar"}
      </button>
      <p className="w-full text-xs text-slate-400">
        Digite sempre o valor positivo — payoff, pagamento de juro e crédito reduzem a dívida
        automaticamente.
      </p>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
