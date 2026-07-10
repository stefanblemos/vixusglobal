"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { addDraw, type FormState } from "@/lib/actions/pool-loan";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-2.5 text-sm text-slate-600";
const tdRight = "px-3 py-2.5 text-right text-sm tabular-nums text-slate-700";

export type HouseAvailability = {
  id: string | null; // null = linha "sem casa"
  address: string;
  modelLabel: string | null; // "Ilhabela · Citrus" — modelo do simulador + localização
  budget: number | null; // aprovado (d=0)
  credited: number;
  pendingAmount: number;
  available: number | null;
};

const money = (v: number | null) =>
  v == null ? "—" : `$${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

function DrawModal({
  poolId,
  loanId,
  poolLabel,
  feesHint,
  house,
  onClose,
}: {
  poolId: string;
  loanId: string;
  poolLabel: string;
  feesHint: string;
  house: HouseAvailability;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(addDraw, undefined);
  useEffect(() => {
    if (state && !state.error) onClose(); // { ok: true }
  }, [state, onClose]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6"
      onClick={onClose}
    >
      <div className="w-full max-w-lg rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div>
            <h3 className="text-lg font-semibold text-slate-800">Novo draw — {house.address}</h3>
            <p className="text-xs text-slate-400">{poolLabel}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <div className="grid grid-cols-3 gap-3 border-b border-slate-100 px-6 py-3 text-center">
          <div>
            <div className="text-xs text-slate-400">Aprovado (d=0)</div>
            <div className="text-sm font-medium tabular-nums">{money(house.budget)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Creditado + aguardando</div>
            <div className="text-sm font-medium tabular-nums">
              {money(house.credited + house.pendingAmount)}
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-400">Disponível</div>
            <div
              className={`text-sm font-semibold tabular-nums ${
                house.available != null && house.available < 0 ? "text-red-600" : "text-emerald-700"
              }`}
            >
              {money(house.available)}
            </div>
          </div>
        </div>

        <form action={formAction} className="space-y-4 px-6 py-4">
          <input type="hidden" name="poolId" value={poolId} />
          <input type="hidden" name="loanId" value={loanId} />
          {house.id && <input type="hidden" name="houseId" value={house.id} />}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Valor solicitado $ *</label>
              <input name="requestedAmount" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Data da solicitação *</label>
              <input name="requestDate" type="date" defaultValue={today} required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Liberado $ (se já souber)</label>
              <input name="releasedAmount" placeholder="vazio = aguardando" className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Data do crédito</label>
              <input name="creditDate" type="date" className={inputClass} />
            </div>
            <div className="col-span-2">
              <label className={labelClass}>Memo</label>
              <input name="memo" placeholder="Medição #3 — drywall" className={inputClass} />
            </div>
          </div>
          <p className="text-xs text-slate-400">
            Sem o liberado, o pedido fica <span className="font-medium">aguardando o banco</span> no
            ledger (fora do saldo); registre a liberação quando a resposta chegar. {feesHint}
          </p>
          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
            >
              {pending ? "Lançando…" : "Solicitar draw"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function DrawHousesPanel({
  poolId,
  loanId,
  poolLabel,
  feesHint,
  houses,
}: {
  poolId: string;
  loanId: string;
  poolLabel: string;
  feesHint: string;
  houses: HouseAvailability[];
}) {
  const [selected, setSelected] = useState<HouseAvailability | null>(null);
  const totals = houses.reduce(
    (t, h) => ({
      budget: t.budget + (h.budget ?? 0),
      credited: t.credited + h.credited,
      pending: t.pending + h.pendingAmount,
    }),
    { budget: 0, credited: 0, pending: 0 },
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-medium text-slate-800">Disponibilidade por casa</h2>
        <p className="text-xs text-slate-400">
          Clique na casa para solicitar um draw. Disponível = aprovado (d=0) − creditado −
          aguardando.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className={th}>Casa</th>
              <th className={th}>Modelo · Local</th>
              <th className={thRight}>Aprovado (d=0)</th>
              <th className={thRight}>Creditado</th>
              <th className={thRight}>Aguardando</th>
              <th className={thRight}>Disponível</th>
            </tr>
          </thead>
          <tbody>
            {houses.map((h, i) => (
              <tr
                key={h.id ?? `none-${i}`}
                onClick={() => setSelected(h)}
                className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/70"
              >
                <td className={`${td} font-medium text-slate-800`}>{h.address}</td>
                <td className={`${td} text-slate-500`}>
                  {h.modelLabel ?? <span className="text-xs text-slate-300">definir na ficha</span>}
                </td>
                <td className={tdRight}>{money(h.budget)}</td>
                <td className={tdRight}>{money(h.credited)}</td>
                <td className={`${tdRight} ${h.pendingAmount > 0 ? "text-blue-700" : "text-slate-400"}`}>
                  {h.pendingAmount > 0 ? money(h.pendingAmount) : "—"}
                </td>
                <td
                  className={`${tdRight} font-semibold ${
                    h.available == null
                      ? "text-slate-400"
                      : h.available < 0
                        ? "text-red-600"
                        : h.available === 0
                          ? "text-slate-400"
                          : "text-emerald-700"
                  }`}
                >
                  {money(h.available)}
                </td>
              </tr>
            ))}
            <tr className="bg-slate-50/60">
              <td className={`${td} font-semibold text-slate-800`}>Total</td>
              <td className={td}></td>
              <td className={`${tdRight} font-semibold`}>{money(totals.budget)}</td>
              <td className={`${tdRight} font-semibold`}>{money(totals.credited)}</td>
              <td className={`${tdRight} font-semibold`}>{money(totals.pending)}</td>
              <td className={`${tdRight} font-semibold`}>
                {money(totals.budget - totals.credited - totals.pending)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {selected && (
        <DrawModal
          poolId={poolId}
          loanId={loanId}
          poolLabel={poolLabel}
          feesHint={feesHint}
          house={selected}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
