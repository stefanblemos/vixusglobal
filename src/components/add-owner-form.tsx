"use client";

import { useActionState } from "react";
import { createOwnership, type FormState } from "@/lib/actions/ownership";

type OwnerOption = { value: string; label: string; group: string };

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30";

export function AddOwnerForm({
  companyId,
  options,
  defaultEffectiveDate,
}: {
  companyId: string;
  options: OwnerOption[];
  defaultEffectiveDate?: string;
}) {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    createOwnership,
    undefined,
  );

  const parties = options.filter((o) => o.group === "Owners");
  const companies = options.filter((o) => o.group === "Companies");

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="ownedCompanyId" value={companyId} />
      <div className="min-w-56 flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-600">Owner</label>
        <select name="owner" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Select…
          </option>
          {parties.length > 0 && (
            <optgroup label="Owners (individuals/entities)">
              {parties.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
          {companies.length > 0 && (
            <optgroup label="Companies">
              {companies.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </optgroup>
          )}
        </select>
      </div>
      <div className="w-28">
        <label className="mb-1 block text-xs font-medium text-slate-600">Ownership %</label>
        <input
          name="percentage"
          type="number"
          step="0.0001"
          min="0"
          max="100"
          required
          className={inputClass}
        />
      </div>
      <div className="w-40">
        <label className="mb-1 block text-xs font-medium text-slate-600">Effective date</label>
        <input
          name="effectiveDate"
          type="date"
          defaultValue={defaultEffectiveDate}
          className={inputClass}
        />
      </div>
      <div className="w-32">
        <label className="mb-1 block text-xs font-medium text-slate-600">Class (optional)</label>
        <input name="shareClass" placeholder="e.g. Class A" className={inputClass} />
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
      >
        {isPending ? "Adding…" : "Add"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
