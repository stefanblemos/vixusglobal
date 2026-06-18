"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createLoan, type FormState } from "@/lib/actions/loans";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

type Co = { id: string; legalName: string };

export function LoanCreateForm({ companies }: { companies: Co[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(createLoan, undefined);

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="lenderCompanyId" className={labelClass}>
            Lender *
          </label>
          <select id="lenderCompanyId" name="lenderCompanyId" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Select…
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="borrowerCompanyId" className={labelClass}>
            Borrower *
          </label>
          <select id="borrowerCompanyId" name="borrowerCompanyId" required defaultValue="" className={inputClass}>
            <option value="" disabled>
              Select…
            </option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.legalName}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div>
          <label htmlFor="annualInterestRatePct" className={labelClass}>
            Annual rate %
          </label>
          <input id="annualInterestRatePct" name="annualInterestRatePct" defaultValue="6.5" className={inputClass} />
        </div>
        <div>
          <label htmlFor="originationFeeRatePct" className={labelClass}>
            Origination fee %
          </label>
          <input id="originationFeeRatePct" name="originationFeeRatePct" defaultValue="1" className={inputClass} />
        </div>
        <div>
          <label htmlFor="currency" className={labelClass}>
            Currency
          </label>
          <input id="currency" name="currency" defaultValue="USD" className={inputClass} />
        </div>
        <div>
          <label htmlFor="startDate" className={labelClass}>
            Start date
          </label>
          <input id="startDate" name="startDate" type="date" className={inputClass} />
        </div>
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="flex items-center justify-end gap-3 pt-2">
        <Link
          href="/loans"
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create loan"}
        </button>
      </div>
      <p className="text-xs text-slate-400">
        After creating, open the loan and import the QBO register to load the ledger. The rate can be
        adjusted per year on the loan page.
      </p>
    </form>
  );
}
