"use client";

import { useActionState, useState } from "react";
import { createAsset, type AssetFormState } from "@/lib/actions/assets";
import { ASSET_CATEGORIES, categoryByKey } from "@/lib/assets/categories";

const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30";
const label = "mb-1 block text-xs font-medium text-slate-600";

export function AssetCreateForm({
  companies,
}: {
  companies: { id: string; legalName: string }[];
}) {
  const [state, action, pending] = useActionState<AssetFormState, FormData>(createAsset, undefined);
  const [category, setCategory] = useState("EQUIPMENT");
  const cat = categoryByKey(category);

  return (
    <form action={action} className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className={label}>Company *</label>
          <select name="companyId" required className={input} defaultValue="">
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
          <label className={label}>Asset name *</label>
          <input name="name" required placeholder="e.g. Ford F-150" className={input} />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className={label}>Type</label>
          <select
            name="category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className={input}
          >
            {ASSET_CATEGORIES.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={label}>Acquired (in service) *</label>
          <input name="acquisitionDate" type="date" required className={input} />
        </div>
        <div>
          <label className={label}>Cost *</label>
          <input name="cost" inputMode="decimal" placeholder="0.00" className={input} />
        </div>
        <div>
          <label className={label}>Recovery (years)</label>
          <input
            name="recoveryYears"
            key={category}
            defaultValue={cat.recoveryYears}
            inputMode="decimal"
            className={input}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div>
          <label className={label}>§179 amount</label>
          <input name="section179" inputMode="decimal" placeholder="0.00" className={input} />
        </div>
        <div>
          <label className={label}>Bonus %</label>
          <input name="bonusPct" inputMode="decimal" placeholder="0" className={input} />
        </div>
        <div className="md:col-span-2">
          <label className={label}>Notes</label>
          <input name="notes" className={input} />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-400">
          {cat.method === "SL_MM"
            ? "Real property → straight-line, mid-month."
            : `MACRS ${cat.recoveryYears}-yr, half-year convention.`}
          {cat.hint ? ` ${cat.hint}.` : ""}
        </p>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Add asset"}
        </button>
      </div>
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
