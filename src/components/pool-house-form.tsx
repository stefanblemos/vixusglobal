"use client";

import { useActionState } from "react";
import Link from "next/link";
import { addHouse, updateHouse, type FormState } from "@/lib/actions/pools";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

const STATUSES = [
  ["PLANNED", "Planned"],
  ["LOT_PURCHASED", "Lot purchased"],
  ["UNDER_CONSTRUCTION", "Under construction"],
  ["FOR_SALE", "For sale"],
  ["UNDER_CONTRACT", "Under contract"],
  ["SOLD", "Sold"],
] as const;

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

export type HouseFormValues = {
  id: string;
  poolId: string;
  address: string;
  status: string;
  plannedLotCost: string;
  plannedBuildCost: string;
  plannedSalePrice: string;
  plannedClosingCost: string;
  bankName: string;
  bankLoanAmount: string;
  bankOriginationFee: string;
  bankInterestReserve: string;
  bankCashToClose: string;
  bankBudgetReviewFee: string;
  bankCharges: string;
  actualLotCost: string;
  actualBuildCost: string;
  ownCapital: string;
  soldPrice: string;
  payoffAmount: string;
  closingCost: string;
  contractDate: string;
  saleDate: string;
  notes: string;
};

function Field({
  name,
  label,
  values,
  type,
}: {
  name: keyof HouseFormValues;
  label: string;
  values: HouseFormValues;
  type?: string;
}) {
  return (
    <div>
      <label htmlFor={`house-${name}`} className={labelClass}>
        {label}
      </label>
      <input
        id={`house-${name}`}
        name={name}
        type={type}
        defaultValue={values[name]}
        className={inputClass}
      />
    </div>
  );
}

// Edição completa: pro forma + premissas do banco + realizado.
export function PoolHouseForm({ values }: { values: HouseFormValues }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    updateHouse.bind(null, values.id),
    undefined,
  );

  return (
    <form action={formAction} className="space-y-6 rounded-xl border border-slate-200 bg-white p-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <div className="col-span-2 md:col-span-3">
          <label htmlFor="house-address" className={labelClass}>
            Address *
          </label>
          <input
            id="house-address"
            name="address"
            required
            defaultValue={values.address}
            className={inputClass}
          />
        </div>
        <div>
          <label htmlFor="house-status" className={labelClass}>
            Status
          </label>
          <select id="house-status" name="status" defaultValue={values.status} className={inputClass}>
            {STATUSES.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Pro forma (expected)</h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field name="plannedLotCost" label="Lot cost" values={values} />
          <Field name="plannedBuildCost" label="Construction cost" values={values} />
          <Field name="plannedSalePrice" label="Sale price" values={values} />
          <Field name="plannedClosingCost" label="Closing cost" values={values} />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Bank terms (construction loan)</h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field name="bankName" label="Bank" values={values} />
          <Field name="bankLoanAmount" label="Original loan" values={values} />
          <Field name="bankOriginationFee" label="Origination fee" values={values} />
          <Field name="bankInterestReserve" label="Interest reserve" values={values} />
          <Field name="bankCashToClose" label="Cash to close" values={values} />
          <Field name="bankBudgetReviewFee" label="Budget review fee" values={values} />
          <Field name="bankCharges" label="Bank charges" values={values} />
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Actuals</h3>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Field name="actualLotCost" label="Lot cost (actual)" values={values} />
          <Field name="actualBuildCost" label="Construction (actual)" values={values} />
          <Field name="ownCapital" label="Own capital used" values={values} />
          <Field name="soldPrice" label="Sold price" values={values} />
          <Field name="payoffAmount" label="Bank payoff" values={values} />
          <Field name="closingCost" label="Closing cost (actual)" values={values} />
          <Field name="contractDate" label="Contract date" values={values} type="date" />
          <Field name="saleDate" label="Sale date" values={values} type="date" />
        </div>
      </div>

      <div>
        <label htmlFor="house-notes" className={labelClass}>
          Notes
        </label>
        <textarea id="house-notes" name="notes" rows={2} defaultValue={values.notes} className={inputClass} />
      </div>

      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

      <div className="flex items-center justify-end gap-3">
        <Link
          href={`/pools/${values.poolId}`}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Cancel
        </Link>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save house"}
        </button>
      </div>
    </form>
  );
}
