"use client";

import { useActionState } from "react";
import Link from "next/link";
import { updateCompany, type FormState } from "@/lib/actions/companies";
import { JURISDICTIONS, RELATIONSHIPS, ENTITY_TYPES_BY_JURISDICTION } from "@/lib/catalog";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export type EditableCompany = {
  id: string;
  legalName: string;
  tradeName: string | null;
  aliases: string[];
  jurisdiction: string;
  state: string | null;
  entityType: string;
  taxId: string | null;
  formationDate: string | null;
  closedDate: string | null;
  fiscalYearEnd: string;
  baseCurrency: string;
  relationship: string;
  status: string;
  collectsSalesTax: boolean;
  hasEmployees: boolean;
  monitored: boolean;
  controlsTax: boolean;
  notes: string | null;
};

export function CompanyEditForm({ company }: { company: EditableCompany }) {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    updateCompany,
    undefined,
  );

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <input type="hidden" name="id" value={company.id} />
      <div>
        <label htmlFor="legalName" className={labelClass}>
          Legal name *
        </label>
        <input
          id="legalName"
          name="legalName"
          required
          defaultValue={company.legalName}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="tradeName" className={labelClass}>
            Trade name
          </label>
          <input
            id="tradeName"
            name="tradeName"
            defaultValue={company.tradeName ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="aliases" className={labelClass}>
            Former / alternate names
          </label>
          <input
            id="aliases"
            name="aliases"
            defaultValue={company.aliases.join(", ")}
            placeholder="comma-separated"
            className={inputClass}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="jurisdiction" className={labelClass}>
            Jurisdiction *
          </label>
          <select
            id="jurisdiction"
            name="jurisdiction"
            required
            defaultValue={company.jurisdiction}
            className={inputClass}
          >
            {JURISDICTIONS.map((j) => (
              <option key={j.value} value={j.value}>
                {j.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="entityType" className={labelClass}>
            Entity type *
          </label>
          <select
            id="entityType"
            name="entityType"
            required
            defaultValue={company.entityType}
            className={inputClass}
          >
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
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="state" className={labelClass}>
            State (e.g. FL)
          </label>
          <input
            id="state"
            name="state"
            defaultValue={company.state ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="formationDate" className={labelClass}>
            Formation date
          </label>
          <input
            id="formationDate"
            name="formationDate"
            defaultValue={company.formationDate ?? ""}
            placeholder="e.g. 10/06/2022 or 2022"
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="status" className={labelClass}>
            Status
          </label>
          <select
            id="status"
            name="status"
            defaultValue={company.status}
            className={inputClass}
          >
            <option value="ACTIVE">Active</option>
            <option value="INACTIVE">Inactive (closed)</option>
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="closedDate" className={labelClass}>
            Closing date
          </label>
          <input
            id="closedDate"
            name="closedDate"
            defaultValue={company.closedDate ?? ""}
            placeholder="e.g. 12/31/2025 or 2025"
            className={inputClass}
          />
          <p className="mt-1 text-xs text-slate-500">
            After this year the company is N/A in Closing; the closing year requires only the final
            tax return (no QBO). Auto-filled from the IR&rsquo;s &ldquo;Final return&rdquo; if blank.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div>
          <label htmlFor="taxId" className={labelClass}>
            Tax ID (EIN/NIF/CNPJ)
          </label>
          <input
            id="taxId"
            name="taxId"
            defaultValue={company.taxId ?? ""}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="baseCurrency" className={labelClass}>
            Base currency
          </label>
          <input
            id="baseCurrency"
            name="baseCurrency"
            defaultValue={company.baseCurrency}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="fiscalYearEnd" className={labelClass}>
            Fiscal year end
          </label>
          <input
            id="fiscalYearEnd"
            name="fiscalYearEnd"
            defaultValue={company.fiscalYearEnd}
            className={inputClass}
          />
        </div>
      </div>

      <div>
        <label htmlFor="relationship" className={labelClass}>
          Relationship to Vixus *
        </label>
        <select
          id="relationship"
          name="relationship"
          required
          defaultValue={company.relationship}
          className={inputClass}
        >
          {RELATIONSHIPS.map((r) => (
            <option key={r.value} value={r.value}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-wrap gap-6">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="collectsSalesTax"
            defaultChecked={company.collectsSalesTax}
            className="h-4 w-4 rounded border-slate-300"
          />
          Resells products (Florida sales tax)
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="hasEmployees"
            defaultChecked={company.hasEmployees}
            className="h-4 w-4 rounded border-slate-300"
          />
          Has employees (payroll)
        </label>
      </div>

      <div className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
        <input type="hidden" name="monitored" value="false" />
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            name="monitored"
            value="true"
            defaultChecked={company.monitored}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            Monitor this company
            <span className="block text-xs font-normal text-slate-500">
              Uncheck to exclude it from closing, the overview and obligations — e.g. an
              ex-partner&rsquo;s entity you don&rsquo;t control, even though it&rsquo;s in the group.
            </span>
          </span>
        </label>
        <label className="mt-3 flex items-start gap-2 border-t border-slate-200 pt-3 text-sm text-slate-700">
          <input
            type="checkbox"
            name="controlsTax"
            defaultChecked={company.controlsTax}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>
            We handle the income tax (IR)
            <span className="block text-xs font-normal text-slate-500">
              Brings a managed entity (outside the group) into closing — e.g. a partner&rsquo;s
              entity whose return we file. Group members are always included.
            </span>
          </span>
        </label>
      </div>

      <div>
        <label htmlFor="notes" className={labelClass}>
          Notes
        </label>
        <textarea
          id="notes"
          name="notes"
          rows={3}
          defaultValue={company.notes ?? ""}
          className={inputClass}
        />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <Link
          href={`/companies/${company.id}`}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={isPending}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
        >
          {isPending ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
