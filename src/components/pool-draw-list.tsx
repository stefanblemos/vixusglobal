"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { editDraw, resolveDrawOutcome, toggleLoanEntryReconciled, type FormState } from "@/lib/actions/pool-loan";

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
  drawNumber: number | null;
  drawStatus: "REQUESTED" | "APPROVED" | "DENIED" | "CANCELLED";
  denyReason: string | null;
  requestedAmount: string | null;
  requestDate: string | null; // yyyy-mm-dd
  amount: string; // liberado (0 se pendente)
  date: string; // data do crédito (ou da solicitação, se pendente)
  reconciled: boolean;
  memo: string | null;
};

const STATUS_BADGE: Record<DrawRow["drawStatus"], { label: string; cls: string }> = {
  REQUESTED: { label: "Solicitado", cls: "bg-blue-50 text-blue-700" },
  APPROVED: { label: "Aprovado", cls: "bg-emerald-50 text-emerald-700" },
  DENIED: { label: "Negado", cls: "bg-red-50 text-red-600" },
  CANCELLED: { label: "Cancelado", cls: "bg-slate-100 text-slate-500" },
};

const usDate = (iso: string | null) =>
  iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : "-";

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
        <label className={labelClass}>Aprovado $ {draw.pending && "(banco)"}</label>
        <input
          name="releasedAmount"
          defaultValue={draw.pending ? "" : draw.amount}
          placeholder={draw.pending ? "aprovado pelo banco" : ""}
          className={inputClass}
        />
      </div>
      {draw.pending && (
        <div className="w-36">
          <label className={labelClass} title="O valor que CAIU na conta — se for menor que o aprovado, a diferença vira fee retido na fonte, lançado na casa automaticamente">
            Creditado na conta $
          </label>
          <input name="creditedAmount" placeholder="se veio líquido" className={inputClass} />
        </div>
      )}
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
          previstos do contrato são lançados juntos. Se o banco depositou o LÍQUIDO, informe o
          creditado — a diferença vira fee retido na fonte, lançado na casa da inspeção.
        </p>
      )}
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}

// Negar/cancelar um draw pendente — abre um mini-form com o motivo.
function DenyDrawButton({ entryId, drawNumber }: { entryId: string; drawNumber: number | null }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-red-500 hover:text-red-700">
        negar
      </button>
    );
  return (
    <form action={resolveDrawOutcome} className="inline-flex flex-wrap items-center gap-1 align-middle">
      <input type="hidden" name="entryId" value={entryId} />
      <select name="outcome" className="rounded border border-slate-300 px-1 py-0.5 text-[11px]">
        <option value="DENIED">Negado pelo banco</option>
        <option value="CANCELLED">Cancelado por nós</option>
      </select>
      <input name="reason" placeholder={`motivo do Draw #${drawNumber ?? ""}`} className="w-32 rounded border border-slate-300 px-1 py-0.5 text-[11px]" />
      <button type="submit" className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white">ok</button>
      <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-slate-400">cancelar</button>
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
            <th className={th}>Draw</th>
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
              <td colSpan={11} className="px-5 py-6 text-center text-sm text-slate-400">
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
              <DrawRowGroup key={d.id} colSpan={11} open={openId === d.id}>
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
                  <td className={`${td} font-semibold text-slate-700`}>{d.drawNumber != null ? `#${d.drawNumber}` : "—"}</td>
                  <td className={`${td} text-slate-500`}>{d.houseAddress ?? "—"}</td>
                  <td className={td}>
                    <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_BADGE[d.drawStatus].cls}`}>
                      {STATUS_BADGE[d.drawStatus].label}
                    </span>
                    {d.denyReason && <div className="mt-0.5 text-[10px] text-slate-400">{d.denyReason}</div>}
                  </td>
                  <td className={td}>{usDate(d.requestDate)}</td>
                  <td className={tdRight}>{d.requestedAmount != null ? money(d.requestedAmount) : "—"}</td>
                  <td className={td}>{d.pending ? "—" : usDate(d.date)}</td>
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
                  <td className={`${tdRight} text-xs`} onClick={(e) => e.stopPropagation()}>
                    {d.pending && <DenyDrawButton entryId={d.id} drawNumber={d.drawNumber} />}
                    <button type="button" onClick={() => setOpenId(openId === d.id ? null : d.id)} className="ml-2 text-[#1f3a5f]">
                      {openId === d.id ? "fechar" : d.pending ? "registrar liberação" : "editar"}
                    </button>
                  </td>
                </tr>
                {openId === d.id && (
                  <tr>
                    <td colSpan={11} className="px-3 pb-3">
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
