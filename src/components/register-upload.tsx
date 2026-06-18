"use client";

import { useActionState } from "react";
import { importLoanRegister, type FormState } from "@/lib/actions/loans";

export function RegisterUpload({ loanId }: { loanId: string }) {
  const action = importLoanRegister.bind(null, loanId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-center gap-3">
      <input
        type="file"
        name="file"
        accept=".xls,.xlsx,.csv"
        className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm file:text-slate-700 hover:file:bg-slate-200"
      />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
      >
        {pending ? "Importing…" : "Import register"}
      </button>
      {state?.error && <span className="text-sm text-amber-700">{state.error}</span>}
      <span className="basis-full text-xs text-slate-400">
        Upload the QBO account register (.xls/.xlsx/.csv). Increase → disbursement, Decrease →
        repayment, exactly as in the file. This replaces the loan&apos;s transactions.
      </span>
    </form>
  );
}
