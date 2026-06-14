"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createCompany, type FormState } from "@/lib/actions/companies";
import { JURISDICTIONS, RELATIONSHIPS, ENTITY_TYPES_BY_JURISDICTION } from "@/lib/catalog";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export default function NewCompanyPage() {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    createCompany,
    undefined,
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/companies" className="text-sm text-slate-500 hover:text-slate-700">
          ← Empresas
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Nova empresa</h1>
      </div>

      <form
        action={formAction}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-6"
      >
        <div>
          <label htmlFor="legalName" className={labelClass}>
            Razão social *
          </label>
          <input id="legalName" name="legalName" required className={inputClass} />
        </div>

        <div>
          <label htmlFor="tradeName" className={labelClass}>
            Nome fantasia
          </label>
          <input id="tradeName" name="tradeName" className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="jurisdiction" className={labelClass}>
              Jurisdição *
            </label>
            <select id="jurisdiction" name="jurisdiction" required className={inputClass}>
              {JURISDICTIONS.map((j) => (
                <option key={j.value} value={j.value}>
                  {j.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="entityType" className={labelClass}>
              Tipologia *
            </label>
            <select id="entityType" name="entityType" required className={inputClass}>
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
              Estado (ex.: FL)
            </label>
            <input id="state" name="state" className={inputClass} />
          </div>
          <div>
            <label htmlFor="baseCurrency" className={labelClass}>
              Moeda base
            </label>
            <input
              id="baseCurrency"
              name="baseCurrency"
              defaultValue="USD"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="fiscalYearEnd" className={labelClass}>
              Fim do ano fiscal
            </label>
            <input
              id="fiscalYearEnd"
              name="fiscalYearEnd"
              defaultValue="12-31"
              className={inputClass}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="taxId" className={labelClass}>
              Tax ID (EIN/NIF/CNPJ)
            </label>
            <input id="taxId" name="taxId" className={inputClass} />
          </div>
          <div>
            <label htmlFor="relationship" className={labelClass}>
              Relação com a Vixus *
            </label>
            <select id="relationship" name="relationship" required className={inputClass}>
              {RELATIONSHIPS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="notes" className={labelClass}>
            Observações
          </label>
          <textarea id="notes" name="notes" rows={3} className={inputClass} />
        </div>

        {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

        <div className="flex justify-end gap-3 pt-2">
          <Link
            href="/companies"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Cancelar
          </Link>
          <button
            type="submit"
            disabled={isPending}
            className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
          >
            {isPending ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
