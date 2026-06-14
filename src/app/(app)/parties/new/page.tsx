"use client";

import { useActionState } from "react";
import Link from "next/link";
import { createParty, type FormState } from "@/lib/actions/parties";
import { JURISDICTIONS, PARTY_KINDS } from "@/lib/catalog";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export default function NewPartyPage() {
  const [state, formAction, isPending] = useActionState<FormState, FormData>(
    createParty,
    undefined,
  );

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/parties" className="text-sm text-slate-500 hover:text-slate-700">
          ← Donos
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Novo dono</h1>
      </div>

      <form
        action={formAction}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-6"
      >
        <div>
          <label htmlFor="name" className={labelClass}>
            Nome *
          </label>
          <input id="name" name="name" required className={inputClass} />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label htmlFor="kind" className={labelClass}>
              Tipo *
            </label>
            <select id="kind" name="kind" required className={inputClass}>
              {PARTY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="taxJurisdiction" className={labelClass}>
              Jurisdição fiscal *
            </label>
            <select id="taxJurisdiction" name="taxJurisdiction" required className={inputClass}>
              {JURISDICTIONS.map((j) => (
                <option key={j.value} value={j.value}>
                  {j.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="taxId" className={labelClass}>
            Tax ID (SSN/EIN/NIF/CPF)
          </label>
          <input id="taxId" name="taxId" className={inputClass} />
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
            href="/parties"
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
