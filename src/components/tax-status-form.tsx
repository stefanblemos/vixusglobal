"use client";

import { useActionState } from "react";
import { upsertTaxStatus, type FormState } from "@/lib/actions/tax";
import { ENTITY_TYPES_BY_JURISDICTION, TAX_TREATMENTS_BY_JURISDICTION } from "@/lib/catalog";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30";
const labelClass = "mb-1 block text-xs font-medium text-slate-600";

export function TaxStatusForm({
  companyId,
  defaultEntityType,
}: {
  companyId: string;
  defaultEntityType: string;
}) {
  const action = upsertTaxStatus.bind(null, companyId);
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, undefined);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="w-24">
        <label className={labelClass}>Year</label>
        <input name="year" type="number" min="1990" max="2100" required className={inputClass} />
      </div>
      <div className="w-48">
        <label className={labelClass}>Entity type (that year)</label>
        <select name="entityType" defaultValue={defaultEntityType} required className={inputClass}>
          {Object.entries(ENTITY_TYPES_BY_JURISDICTION).map(([jur, types]) => (
            <optgroup key={jur} label={jur}>
              {types.map((t) => (
                <option key={`${jur}-${t.value}`} value={t.value}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="w-56">
        <label className={labelClass}>Tax treatment</label>
        <select name="taxTreatment" required defaultValue="" className={inputClass}>
          <option value="" disabled>
            Select…
          </option>
          {Object.entries(TAX_TREATMENTS_BY_JURISDICTION).map(([jur, types]) => (
            <optgroup key={jur} label={jur}>
              {types.map((t) => (
                <option key={`${jur}-${t.value}`} value={t.value}>
                  {t.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>
      <div className="min-w-40 flex-1">
        <label className={labelClass}>Notes</label>
        <input
          name="notes"
          placeholder="e.g. S-corp election filed 03/2023"
          className={inputClass}
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save year"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
