"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { addDraw, type FormState } from "@/lib/actions/pool-loan";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export type DrawPool = {
  id: string;
  label: string; // "VHP-I · PH3 — Builders Capital (77959)"
  feesHint: string; // "fees previstos por draw: $20 processing + $185 inspection (+$20 ACH por lote)"
  houses: Array<{ id: string; address: string }>;
};

export function AddDrawForm({ pools }: { pools: DrawPool[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(addDraw, undefined);
  const [poolId, setPoolId] = useState(pools[0]?.id ?? "");
  const pool = useMemo(() => pools.find((p) => p.id === poolId) ?? null, [pools, poolId]);

  return (
    <form action={formAction} className="space-y-4 rounded-xl border border-slate-200 bg-white p-6">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <div>
          <label className={labelClass}>Pool *</label>
          <select
            name="poolId"
            value={poolId}
            onChange={(e) => setPoolId(e.target.value)}
            className={inputClass}
          >
            {pools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Casa</label>
          <select name="houseId" defaultValue="" className={inputClass}>
            <option value="">— (draw geral)</option>
            {(pool?.houses ?? []).map((h) => (
              <option key={h.id} value={h.id}>
                {h.address}
              </option>
            ))}
          </select>
        </div>
        <div className="hidden md:block" />
        <div>
          <label className={labelClass}>Valor solicitado $</label>
          <input name="requestedAmount" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Data da solicitação</label>
          <input name="requestDate" type="date" className={inputClass} />
        </div>
        <div className="hidden md:block" />
        <div>
          <label className={labelClass}>Valor liberado $ *</label>
          <input name="releasedAmount" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Data do crédito *</label>
          <input name="creditDate" type="date" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Memo</label>
          <input name="memo" className={inputClass} />
        </div>
      </div>
      {pool && <p className="text-xs text-slate-400">{pool.feesHint}</p>}
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <div className="flex justify-end">
        <button
          type="submit"
          disabled={pending || !poolId}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
        >
          {pending ? "Lançando…" : "+ Lançar draw"}
        </button>
      </div>
    </form>
  );
}
