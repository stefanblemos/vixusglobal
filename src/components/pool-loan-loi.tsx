"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { assignHouseLoan, type FormState } from "@/lib/actions/pool-loan";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

export function HousesByBank({
  poolId,
  houses,
  loans,
}: {
  poolId: string;
  houses: Array<{ id: string; address: string; status: string; loanId: string | null }>;
  loans: Array<{ id: string; label: string }>;
}) {
  const counts = new Map<string | null, number>();
  for (const h of houses) counts.set(h.loanId, (counts.get(h.loanId) ?? 0) + 1);
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-medium text-slate-800">Casas por banco</h2>
        <p className="text-xs text-slate-400">
          Cada casa aponta para o loan que a financia — o draw, os fees e o payoff seguem esse
          vínculo. Sem banco = 100% capital próprio.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {loans.map((l) => (
            <span key={l.id} className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
              {l.label}: <b>{counts.get(l.id) ?? 0}</b>
            </span>
          ))}
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs text-slate-600">
            equity: <b>{counts.get(null) ?? 0}</b>
          </span>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Casa</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Status</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Banco / loan</th>
            </tr>
          </thead>
          <tbody>
            {houses.map((h) => (
              <HouseLoanRow key={h.id} poolId={poolId} house={h} loans={loans} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// Uma linha casa → banco: select com os loans do pool + "equity"; salva ao trocar.
function HouseLoanRow({
  poolId,
  house,
  loans,
}: {
  poolId: string;
  house: { id: string; address: string; status: string; loanId: string | null };
  loans: Array<{ id: string; label: string }>;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    assignHouseLoan.bind(null, poolId),
    undefined,
  );
  return (
    <tr className="border-b border-slate-50">
      <td className="px-3 py-1.5 text-sm text-slate-700">{house.address}</td>
      <td className="px-3 py-1.5 text-xs text-slate-400">{house.status}</td>
      <td className="px-3 py-1.5">
        <form action={formAction}>
          <input type="hidden" name="houseId" value={house.id} />
          <select
            name="loanId"
            defaultValue={house.loanId ?? ""}
            disabled={pending}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="w-64 rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-[#1f3a5f] disabled:opacity-60"
          >
            <option value="">— sem banco (100% equity)</option>
            {loans.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </select>
          {state?.error && <span className="ml-2 text-xs text-red-600">{state.error}</span>}
        </form>
      </td>
    </tr>
  );
}

// "Casas por banco" (15/07): o pool pode ter vários bancos (VHP-II tem 3) — aqui se define
// qual casa pertence a qual loan; draws/fees/payoff passam a seguir esse vínculo.
