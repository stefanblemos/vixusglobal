"use client";

import { useActionState } from "react";
import { updateLoanTerms, type FormState } from "@/lib/actions/loans";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

export interface LoanTermsDefaults {
  annualInterestRatePct: string;
  originationFeeRatePct: string;
  dayCountBasis: string;
  interestMethod: string;
  startDate: string;
  maturityDate: string;
  status: string;
}

export function LoanTermsForm({ loanId, d }: { loanId: string; d: LoanTermsDefaults }) {
  const action = updateLoanTerms.bind(null, loanId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);

  return (
    <form action={formAction} className="grid grid-cols-2 gap-4 md:grid-cols-4">
      <div>
        <label className={labelClass}>Annual interest %</label>
        <input
          name="annualInterestRatePct"
          type="number"
          step="0.0001"
          defaultValue={d.annualInterestRatePct}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Origination fee %</label>
        <input
          name="originationFeeRatePct"
          type="number"
          step="0.0001"
          defaultValue={d.originationFeeRatePct}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Day count</label>
        <select name="dayCountBasis" defaultValue={d.dayCountBasis} className={inputClass}>
          <option value="ACT_365">ACT/365</option>
          <option value="ACT_360">ACT/360</option>
          <option value="D30_360">30/360</option>
        </select>
      </div>
      <div>
        <label className={labelClass}>Interest method</label>
        <select name="interestMethod" defaultValue={d.interestMethod} className={inputClass}>
          <option value="SIMPLE">Simple</option>
          <option value="COMPOUND">Compound</option>
        </select>
      </div>
      <div>
        <label className={labelClass}>Start date</label>
        <input name="startDate" type="date" defaultValue={d.startDate} className={inputClass} />
      </div>
      <div>
        <label className={labelClass}>Maturity (optional)</label>
        <input
          name="maturityDate"
          type="date"
          defaultValue={d.maturityDate}
          className={inputClass}
        />
      </div>
      <div>
        <label className={labelClass}>Status</label>
        <select name="status" defaultValue={d.status} className={inputClass}>
          <option value="ACTIVE">Active</option>
          <option value="PAID">Paid</option>
          <option value="DEFAULTED">Defaulted</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>
      <div className="flex items-end">
        <button
          type="submit"
          disabled={pending}
          className="w-full rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save terms"}
        </button>
      </div>
      {state?.error && <p className="col-span-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
