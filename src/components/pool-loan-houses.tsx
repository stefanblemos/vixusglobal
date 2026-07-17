"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { linkHousesToLoan, unlinkHouseFromLoan, type FormState } from "@/lib/actions/pool-loan";

/**
 * Aba CASAS do loan (mock aprovado 17/07 + ajuste: vínculo via BOTÃO que abre modal):
 * só as casas DESTE loan; clicar na casa abre o loan daquela casa (drawable, sacado,
 * disponível, juros pagos, payoff e lançamentos). Casas sem banco entram pelo modal.
 */

export type LoanHouseEntry = {
  id: string;
  date: string; // dd/mm/aa
  typeLabel: string;
  memo: string | null;
  amountFmt: string;
  negative: boolean;
  pending: boolean;
};

export type LoanHouseRow = {
  id: string;
  address: string;
  sub: string | null;
  statusLabel: string;
  drawableFmt: string | null;
  drawnFmt: string | null;
  availableFmt: string | null;
  interestFmt: string | null;
  payoffFmt: string | null;
  pct: number | null; // sacado / drawable
  entries: LoanHouseEntry[];
};

export type UnlinkedHouse = { id: string; address: string; drawableFmt: string | null };

const th = "px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-slate-400";
const tdRight = "px-3 py-2 text-right text-sm tabular-nums text-slate-700";

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2.5">
      <div className="text-[10px] text-slate-400">{label}</div>
      <div className="text-[15px] font-bold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="text-[10px] text-slate-400">{hint}</div>}
    </div>
  );
}

function LinkHousesModal({
  poolId,
  loanId,
  loanLabel,
  unlinked,
  onClose,
}: {
  poolId: string;
  loanId: string;
  loanLabel: string;
  unlinked: UnlinkedHouse[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    linkHousesToLoan.bind(null, poolId),
    undefined,
  );
  const [checked, setChecked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-base font-semibold text-slate-800">Vincular casas — {loanLabel}</h3>
        <p className="mb-4 text-xs text-slate-400">
          Só aparecem casas ainda SEM loan apontado. O vínculo decide para onde vai o draw, os
          fees e o payoff.
        </p>
        {unlinked.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">
            Todas as casas do pool já têm banco. Para mover uma casa de banco, desvincule-a
            primeiro na aba Casas do loan atual.
          </p>
        ) : (
          <form action={formAction}>
            <input type="hidden" name="loanId" value={loanId} />
            <div className="max-h-72 space-y-1 overflow-y-auto">
              {unlinked.map((h) => (
                <label
                  key={h.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm text-slate-700 hover:bg-slate-50"
                >
                  <input
                    type="checkbox"
                    name="houseIds"
                    value={h.id}
                    checked={checked.has(h.id)}
                    onChange={(e) => {
                      const n = new Set(checked);
                      if (e.target.checked) n.add(h.id);
                      else n.delete(h.id);
                      setChecked(n);
                    }}
                  />
                  <span className="flex-1">{h.address}</span>
                  {h.drawableFmt && (
                    <span className="text-xs tabular-nums text-slate-400">loan da casa: {h.drawableFmt}</span>
                  )}
                </label>
              ))}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                type="submit"
                disabled={pending || checked.size === 0}
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
              >
                {pending ? "Vinculando…" : `Salvar vínculo${checked.size > 0 ? ` (${checked.size})` : ""}`}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-slate-400"
              >
                Cancelar
              </button>
              {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export function PoolLoanHousesTab({
  poolId,
  loanId,
  loanLabel,
  houses,
  unlinked,
  footNote,
}: {
  poolId: string;
  loanId: string;
  loanLabel: string;
  houses: LoanHouseRow[];
  unlinked: UnlinkedHouse[];
  footNote: string | null;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [modal, setModal] = useState(false);
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-medium text-slate-800">Casas — {loanLabel}</h2>
        <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[10.5px] text-emerald-700">
          {houses.length} {houses.length === 1 ? "casa vinculada" : "casas vinculadas"}
        </span>
        <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10.5px] text-slate-500">
          draw · fees · payoff seguem este vínculo
        </span>
        <button
          onClick={() => setModal(true)}
          className="ml-auto rounded-lg border border-slate-300 px-3.5 py-1.5 text-sm font-medium text-[#1f3a5f] hover:border-slate-400"
        >
          + Vincular casas
        </button>
      </div>

      {houses.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-slate-400">
          Nenhuma casa vinculada a este loan ainda — use “+ Vincular casas”.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th} style={{ width: "26%" }}>Casa</th>
                <th className={thRight}>Loan da casa (drawable)</th>
                <th className={thRight}>Sacado</th>
                <th className={thRight}>Disponível</th>
                <th className={thRight}>Juros pagos</th>
                <th className={thRight}>% obra</th>
                <th className={th}></th>
              </tr>
            </thead>
            <tbody>
              {houses.map((h) => (
                <HouseRowPair
                  key={h.id}
                  poolId={poolId}
                  h={h}
                  isOpen={open.has(h.id)}
                  onToggle={() => toggle(h.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {footNote && (
        <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">{footNote}</p>
      )}
      {modal && (
        <LinkHousesModal
          poolId={poolId}
          loanId={loanId}
          loanLabel={loanLabel}
          unlinked={unlinked}
          onClose={() => setModal(false)}
        />
      )}
    </section>
  );
}

function HouseRowPair({
  poolId,
  h,
  isOpen,
  onToggle,
}: {
  poolId: string;
  h: LoanHouseRow;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-b border-slate-50">
        <td className="cursor-pointer px-3 py-2.5" onClick={onToggle}>
          <div className="text-sm font-bold text-[#1f3a5f] hover:underline">
            {isOpen ? "▾" : "▸"} {h.address}
          </div>
          {h.sub && <div className="text-[10.5px] text-slate-400">{h.sub}</div>}
        </td>
        <td className={tdRight}>{h.drawableFmt ?? "—"}</td>
        <td className={tdRight}>{h.drawnFmt ?? "—"}</td>
        <td className={tdRight}>{h.availableFmt ?? "—"}</td>
        <td className={tdRight}>{h.interestFmt ?? "—"}</td>
        <td className={tdRight}>{h.pct != null ? `${h.pct}%` : "—"}</td>
        <td className="px-3 py-2.5">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">
            {h.statusLabel}
          </span>
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-slate-100 bg-slate-50/60">
          <td colSpan={7} className="px-5 py-4">
            <div className="mb-2 text-sm font-bold text-[#1f3a5f]">{h.address} — o loan desta casa</div>
            <div className="mb-3 grid grid-cols-2 gap-2.5 md:grid-cols-5">
              <Kpi label="Drawable (loan da casa)" value={h.drawableFmt ?? "—"} />
              <Kpi
                label="Sacado"
                value={h.drawnFmt ?? "$0"}
                hint={h.pct != null ? `${h.pct}% do drawable` : undefined}
              />
              <Kpi label="Disponível" value={h.availableFmt ?? "—"} />
              <Kpi label="Juros pagos (casa)" value={h.interestFmt ?? "$0"} />
              <Kpi label="Payoff" value={h.payoffFmt ?? "—"} hint={h.payoffFmt ? undefined : "em aberto"} />
            </div>
            {h.entries.length === 0 ? (
              <p className="text-xs text-slate-400">
                Sem lançamentos desta casa ainda — draws, fees, juros e payoff aparecem aqui
                quando entrarem no statement.
              </p>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-200">
                    <th className={th}>Data</th>
                    <th className={th}>Tipo</th>
                    <th className={th}>Memo</th>
                    <th className={thRight}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {h.entries.map((e) => (
                    <tr key={e.id} className="border-b border-slate-100">
                      <td className="px-3 py-1.5 text-xs text-slate-600">{e.date}</td>
                      <td className="px-3 py-1.5 text-xs text-slate-600">
                        {e.typeLabel}
                        {e.pending && (
                          <span className="ml-1.5 rounded-full bg-amber-100 px-1.5 text-[9px] text-amber-700">
                            pendente
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-xs text-slate-400">{e.memo ?? ""}</td>
                      <td className={`px-3 py-1.5 text-right text-xs tabular-nums ${e.negative ? "text-emerald-700" : "text-slate-700"}`}>
                        {e.amountFmt}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <form action={unlinkHouseFromLoan} className="mt-3 text-right">
              <input type="hidden" name="houseId" value={h.id} />
              <input type="hidden" name="poolId" value={poolId} />
              <button
                type="submit"
                className="text-[11px] text-slate-400 hover:text-red-500"
                title="A casa volta a 'sem banco' e pode ser vinculada a outro loan"
              >
                · desvincular do loan
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
