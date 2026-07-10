"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { editDraw, toggleLoanEntryReconciled, type FormState } from "@/lib/actions/pool-loan";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-1.5 text-sm text-slate-600";
const tdRight = "px-3 py-1.5 text-right text-sm tabular-nums text-slate-700";

export type DrawRow = {
  id: string;
  poolId: string;
  poolCode: string;
  houseId: string | null;
  houseAddress: string | null;
  pending: boolean;
  requestedAmount: string | null;
  requestDate: string | null; // yyyy-mm-dd
  amount: string; // liberado (0 se pendente)
  date: string; // data do crédito (ou da solicitação, se pendente)
  reconciled: boolean;
  memo: string | null;
};

const money = (v: string | number | null) =>
  v == null ? "—" : `$${Number(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

function EditDrawForm({
  draw,
  houses,
  onDone,
}: {
  draw: DrawRow;
  houses: Array<{ id: string; address: string }>;
  onDone: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(editDraw, undefined);
  // fecha a edição no sucesso (a linha atualizada reaparece com os dados novos do server);
  // sem isso o React 19 resetava os inputs para os valores antigos e a tela mentia
  useEffect(() => {
    if (state && !state.error) onDone();
  }, [state, onDone]);
  return (
    <form key={JSON.stringify(draw)} action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg bg-slate-50 p-3">
      <input type="hidden" name="entryId" value={draw.id} />
      <div className="min-w-44">
        <label className={labelClass}>Casa</label>
        <select name="houseId" defaultValue={draw.houseId ?? ""} className={inputClass}>
          <option value="">—</option>
          {houses.map((h) => (
            <option key={h.id} value={h.id}>
              {h.address}
            </option>
          ))}
        </select>
      </div>
      <div className="w-32">
        <label className={labelClass}>Solicitado $</label>
        <input name="requestedAmount" defaultValue={draw.requestedAmount ?? ""} className={inputClass} />
      </div>
      <div className="w-40">
        <label className={labelClass}>Data solicitação</label>
        <input name="requestDate" type="date" defaultValue={draw.requestDate ?? ""} className={inputClass} />
      </div>
      <div className="w-32">
        <label className={labelClass}>Liberado $ {draw.pending && "(banco)"}</label>
        <input
          name="releasedAmount"
          defaultValue={draw.pending ? "" : draw.amount}
          placeholder={draw.pending ? "aprovado pelo banco" : ""}
          className={inputClass}
        />
      </div>
      <div className="w-40">
        <label className={labelClass}>Data do crédito</label>
        <input name="creditDate" type="date" defaultValue={draw.pending ? "" : draw.date} className={inputClass} />
      </div>
      <div className="min-w-40 flex-1">
        <label className={labelClass}>Memo</label>
        <input name="memo" defaultValue={draw.memo ?? ""} className={inputClass} />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
      >
        {pending ? "Salvando…" : draw.pending ? "Registrar liberação" : "Salvar"}
      </button>
      <button
        type="button"
        onClick={onDone}
        className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
      >
        Fechar
      </button>
      {draw.pending && (
        <p className="w-full text-xs text-slate-400">
          Ao registrar a liberação, o draw entra no saldo do loan na data do crédito e os fees
          previstos do contrato são lançados juntos.
        </p>
      )}
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

export function DrawList({
  draws,
  housesByPool,
}: {
  draws: DrawRow[];
  housesByPool: Record<string, Array<{ id: string; address: string }>>;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100">
            <th className={th}>Pool</th>
            <th className={th}>Casa</th>
            <th className={th}>Status</th>
            <th className={th}>Solicitado em</th>
            <th className={thRight}>Solicitado</th>
            <th className={th}>Creditado em</th>
            <th className={thRight}>Liberado</th>
            <th className={thRight}>Δ</th>
            <th className={thRight}>✓</th>
            <th className={thRight}></th>
          </tr>
        </thead>
        <tbody>
          {draws.length === 0 && (
            <tr>
              <td colSpan={10} className="px-5 py-6 text-center text-sm text-slate-400">
                Nenhum draw lançado ainda.
              </td>
            </tr>
          )}
          {draws.map((d) => {
            const delta =
              !d.pending && d.requestedAmount != null
                ? Number(d.amount) - Number(d.requestedAmount)
                : null;
            return (
              <DrawRowGroup key={d.id} colSpan={10} open={openId === d.id}>
                <tr
                  className={`cursor-pointer border-b border-slate-50 ${
                    d.pending ? "bg-blue-50/40" : d.reconciled ? "" : "bg-amber-50/30"
                  }`}
                  onClick={() => setOpenId(openId === d.id ? null : d.id)}
                >
                  <td className={td}>
                    <Link
                      href={`/pools/${d.poolId}/loan`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-medium text-[#1f3a5f] hover:underline"
                    >
                      {d.poolCode}
                    </Link>
                  </td>
                  <td className={`${td} text-slate-500`}>{d.houseAddress ?? "—"}</td>
                  <td className={td}>
                    {d.pending ? (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                        Aguardando banco
                      </span>
                    ) : (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                        Creditado
                      </span>
                    )}
                  </td>
                  <td className={td}>{d.requestDate ?? "—"}</td>
                  <td className={tdRight}>{d.requestedAmount != null ? money(d.requestedAmount) : "—"}</td>
                  <td className={td}>{d.pending ? "—" : d.date}</td>
                  <td className={`${tdRight} font-medium`}>{d.pending ? "—" : money(d.amount)}</td>
                  <td className={`${tdRight} ${delta != null && delta !== 0 ? "text-amber-600" : "text-slate-400"}`}>
                    {delta != null ? money(delta) : "—"}
                  </td>
                  <td className={tdRight} onClick={(e) => e.stopPropagation()}>
                    {!d.pending && (
                      <form action={toggleLoanEntryReconciled} className="inline">
                        <input type="hidden" name="entryId" value={d.id} />
                        <input type="hidden" name="poolId" value={d.poolId} />
                        <button
                          type="submit"
                          className={d.reconciled ? "text-emerald-600" : "text-slate-300 hover:text-emerald-600"}
                        >
                          ✓
                        </button>
                      </form>
                    )}
                  </td>
                  <td className={`${tdRight} text-xs text-[#1f3a5f]`}>
                    {openId === d.id ? "fechar" : d.pending ? "registrar liberação" : "editar"}
                  </td>
                </tr>
                {openId === d.id && (
                  <tr>
                    <td colSpan={10} className="px-3 pb-3">
                      <EditDrawForm
                        draw={d}
                        houses={housesByPool[d.poolId] ?? []}
                        onDone={() => setOpenId(null)}
                      />
                    </td>
                  </tr>
                )}
              </DrawRowGroup>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// Wrapper para agrupar linha + edição sem quebrar a tabela
function DrawRowGroup({ children }: { children: React.ReactNode; colSpan: number; open: boolean }) {
  return <>{children}</>;
}
