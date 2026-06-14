"use client";

import { useActionState } from "react";
import { addLoanTransaction, type FormState } from "@/lib/actions/loans";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

const TYPES = [
  { value: "DISBURSEMENT", label: "Disbursement" },
  { value: "REPAYMENT_PRINCIPAL", label: "Principal repayment" },
  { value: "REPAYMENT_INTEREST", label: "Interest repayment" },
  { value: "ORIGINATION_FEE", label: "Origination fee" },
  { value: "ADJUSTMENT", label: "Adjustment" },
];

export function AddTransactionForm({ loanId }: { loanId: string }) {
  const action = addLoanTransaction.bind(null, loanId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="w-48">
        <label className={labelClass}>Type</label>
        <select name="type" required className={inputClass}>
          {TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="w-36">
        <label className={labelClass}>Amount</label>
        <input name="amount" type="number" step="0.01" min="0" required className={inputClass} />
      </div>
      <div className="w-40">
        <label className={labelClass}>Date</label>
        <input name="date" type="date" required className={inputClass} />
      </div>
      <div className="min-w-40 flex-1">
        <label className={labelClass}>Memo (optional)</label>
        <input name="memo" className={inputClass} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
      >
        {pending ? "Adding…" : "Add"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
