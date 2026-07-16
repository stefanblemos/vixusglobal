"use client";

import { useActionState } from "react";
import { addHouse, type FormState } from "@/lib/actions/pools";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

// Adição rápida na página do pool: só endereço + pro forma básico. O resto na página da casa.
export function AddHouseForm({ poolId }: { poolId: string }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addHouse.bind(null, poolId),
    undefined,
  );
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1">
        <label htmlFor="new-house-address" className={labelClass}>
          Address
        </label>
        <input
          id="new-house-address"
          name="address"
          required
          placeholder="21021 Peachland Blvd, Port Charlotte"
          className={inputClass}
        />
      </div>
      <div className="w-40">
        <label htmlFor="new-house-planned-sale" className={labelClass}>
          Planned sale price
        </label>
        <input id="new-house-planned-sale" name="plannedSalePrice" className={inputClass} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
      >
        {pending ? "Adding…" : "+ Add house"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
