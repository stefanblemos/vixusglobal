"use client";

import { useMemo, useState, useTransition } from "react";
import { markBatchCommunicated, registerBatchRelease, type FormState } from "@/lib/actions/pool-loan";

// #draws — painel de LEVAS (draws em lote): um Draw # cobre N casas. Aqui ficam as ações de
// lote — registrar a liberação de todas as casas de uma vez (com ajuste proporcional/manual,
// parcial e líquido) e marcar o comunicado ao banco da leva inteira.

export type BatchHouse = { entryId: string; address: string; requested: number };
export type DrawBatch = {
  drawNumber: number;
  houses: BatchHouse[];
  totalRequested: number;
  communicated: boolean; // todas as casas da leva já comunicadas
  communicatedDate: string | null; // yyyy-mm-dd da mais antiga
};
export type BatchBank = {
  loanId: string;
  poolName: string;
  loanNumber: string | null;
  bankName: string;
  inspectionBilledSeparately: boolean;
  inspectionFee: number;
};

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const parse = (s: string) => Number(String(s).replace(/[^0-9.]/g, "")) || 0;
const inp =
  "rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const lbl = "mb-1 block text-xs font-medium text-slate-500";

export function DrawBatchPanel({ bank, batches }: { bank: BatchBank; batches: DrawBatch[] }) {
  const [releaseFor, setReleaseFor] = useState<DrawBatch | null>(null);
  const [commFor, setCommFor] = useState<number | null>(null);
  if (batches.length === 0) return null;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <section className="rounded-xl border border-blue-100 bg-blue-50/40 px-5 py-4">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Levas pendentes</h2>
      <p className="mt-0.5 text-xs text-slate-500">
        Um Draw # foi pedido em conjunto. Registre a liberação e o comunicado da <b>leva inteira</b> —
        não casa a casa.
      </p>
      <div className="mt-3 space-y-2.5">
        {batches.map((b) => (
          <div
            key={b.drawNumber}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3"
          >
            <div className="min-w-0">
              <span className="text-sm font-semibold text-slate-800">Draw #{b.drawNumber}</span>
              <span className="text-sm text-slate-500">
                {" "}
                · {b.houses.length} {b.houses.length === 1 ? "casa" : "casas"} · solicitado{" "}
                {money(b.totalRequested)}
              </span>
              <div className="mt-1">
                {b.communicated ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-medium text-emerald-700">
                    comunicado ao banco{b.communicatedDate ? ` · ${b.communicatedDate}` : ""}
                  </span>
                ) : (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-medium text-amber-700">
                    a comunicar ao banco
                  </span>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {commFor === b.drawNumber ? (
                <form action={markBatchCommunicated} className="flex items-end gap-1.5">
                  <input type="hidden" name="loanId" value={bank.loanId} />
                  <input type="hidden" name="drawNumber" value={b.drawNumber} />
                  <input name="date" type="date" defaultValue={b.communicatedDate ?? today} className={`${inp} px-2 py-1 text-xs`} />
                  <button type="submit" onClick={() => setCommFor(null)} className="rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700">
                    ok
                  </button>
                  <button type="button" onClick={() => setCommFor(null)} className="text-xs text-slate-400">✕</button>
                </form>
              ) : (
                <button
                  type="button"
                  onClick={() => setCommFor(b.drawNumber)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  {b.communicated ? "ajustar comunicado" : "marcar comunicado"}
                </button>
              )}
              <button
                type="button"
                onClick={() => setReleaseFor(b)}
                className="rounded-lg bg-[#1f3a5f] px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-[#16304f]"
              >
                Registrar liberação ▸
              </button>
            </div>
          </div>
        ))}
      </div>

      {releaseFor && (
        <BatchReleaseModal bank={bank} batch={releaseFor} onClose={() => setReleaseFor(null)} />
      )}
    </section>
  );
}

function BatchReleaseModal({ bank, batch, onClose }: { bank: BatchBank; batch: DrawBatch; onClose: () => void }) {
  const [mode, setMode] = useState<"prop" | "man">("prop");
  const [total, setTotal] = useState(batch.totalRequested.toFixed(2));
  const [manual, setManual] = useState<Record<string, string>>(
    () => Object.fromEntries(batch.houses.map((h) => [h.entryId, h.requested.toFixed(2)])),
  );
  const [net, setNet] = useState<Record<string, string>>({});
  const [creditDate, setCreditDate] = useState(new Date().toISOString().slice(0, 10));
  const [inspectionDeducted, setInspectionDeducted] = useState(false);
  const [pending, start] = useTransition();
  const [state, setState] = useState<FormState>(undefined);

  // liberado por casa conforme o modo
  const released = useMemo(() => {
    if (mode === "man") {
      return Object.fromEntries(batch.houses.map((h) => [h.entryId, parse(manual[h.entryId] ?? "")]));
    }
    const t = parse(total);
    const out: Record<string, number> = {};
    let sum = 0;
    for (const h of batch.houses) {
      const v = Math.round((t * h.requested) / batch.totalRequested * 100) / 100;
      out[h.entryId] = v;
      sum += v;
    }
    const resid = Math.round((t - sum) * 100) / 100;
    if (resid !== 0 && batch.houses.length > 0) {
      const biggest = batch.houses.reduce((a, b) => (a.requested >= b.requested ? a : b));
      out[biggest.entryId] = Math.round((out[biggest.entryId]! + resid) * 100) / 100;
    }
    return out;
  }, [mode, total, manual, batch]);

  const totLib = batch.houses.reduce((s, h) => s + (released[h.entryId] ?? 0), 0);
  const totDelta = totLib - batch.totalRequested;

  const submit = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("loanId", bank.loanId);
      fd.set("drawNumber", String(batch.drawNumber));
      fd.set("creditDate", creditDate);
      if (inspectionDeducted) fd.set("inspectionDeducted", "on");
      for (const h of batch.houses) {
        const v = released[h.entryId] ?? 0;
        if (v > 0) fd.set(`rel_${h.entryId}`, String(v));
        const n = parse(net[h.entryId] ?? "");
        if (n > 0) fd.set(`net_${h.entryId}`, String(n));
      }
      const res = await registerBatchRelease(undefined, fd);
      setState(res);
      if (res?.ok) onClose();
    });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-slate-100 px-6 py-4">
          <h3 className="text-base font-semibold text-slate-800">
            Registrar liberação — Draw #{batch.drawNumber} · {bank.bankName}
          </h3>
          <p className="text-xs text-slate-400">
            {batch.houses.length} casas · solicitado {money(batch.totalRequested)}
          </p>
        </div>

        <div className="px-6 py-4">
          {bank.inspectionBilledSeparately && (
            <label className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <input type="checkbox" className="mt-0.5" checked={inspectionDeducted} onChange={(e) => setInspectionDeducted(e.target.checked)} />
              <span className="text-xs leading-relaxed text-amber-800">
                A inspeção do <b>{bank.bankName}</b> é cobrada à parte (invoice). Marque só se a taxa
                {bank.inspectionFee > 0 ? ` (${money(bank.inspectionFee)})` : ""} <b>já foi descontada</b> deste
                crédito; senão, ela virá numa invoice separada e não é lançada agora.
              </span>
            </label>
          )}

          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="inline-flex overflow-hidden rounded-lg border border-slate-300">
              <button type="button" onClick={() => setMode("prop")} className={`px-3 py-1.5 text-xs font-semibold ${mode === "prop" ? "bg-[#1f3a5f] text-white" : "text-slate-500"}`}>
                Distribuição proporcional
              </button>
              <button type="button" onClick={() => { setManual(Object.fromEntries(batch.houses.map((h) => [h.entryId, (released[h.entryId] ?? 0).toFixed(2)]))); setMode("man"); }} className={`px-3 py-1.5 text-xs font-semibold ${mode === "man" ? "bg-[#1f3a5f] text-white" : "text-slate-500"}`}>
                Por casa (manual)
              </button>
            </div>
            <div>
              <label className={lbl}>Data do crédito</label>
              <input type="date" value={creditDate} onChange={(e) => setCreditDate(e.target.value)} className={`${inp} w-40`} />
            </div>
          </div>

          {mode === "prop" && (
            <div className="mt-3">
              <label className={lbl}>Total liberado pelo banco</label>
              <input value={total} onChange={(e) => setTotal(e.target.value)} className={`${inp} w-48`} />
              <span className="ml-2 text-[11px] text-slate-400">rateado pela fatia solicitada de cada casa</span>
            </div>
          )}

          <div className="mt-3 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100 text-left text-[10px] font-medium uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-1.5">Casa</th>
                  <th className="px-2 py-1.5 text-right">Solicitado</th>
                  <th className="px-2 py-1.5 text-right">Liberado</th>
                  <th className="px-2 py-1.5 text-right">Δ</th>
                  <th className="px-2 py-1.5 text-right" title="Se o banco depositar o líquido, informe o creditado — a diferença vira fee retido">Creditado líq. (opc.)</th>
                </tr>
              </thead>
              <tbody>
                {batch.houses.map((h) => {
                  const lib = released[h.entryId] ?? 0;
                  const d = Math.round((lib - h.requested) * 100) / 100;
                  return (
                    <tr key={h.entryId} className="border-b border-slate-50 text-sm">
                      <td className="px-2 py-2 font-medium text-slate-700">{h.address.split(",")[0]}</td>
                      <td className="px-2 py-2 text-right tabular-nums text-slate-500">{money(h.requested)}</td>
                      <td className="px-2 py-2 text-right">
                        {mode === "man" ? (
                          <input
                            value={manual[h.entryId] ?? ""}
                            onChange={(e) => setManual((m) => ({ ...m, [h.entryId]: e.target.value }))}
                            className="w-28 rounded border border-slate-300 px-2 py-1 text-right text-sm tabular-nums outline-none focus:border-[#1f3a5f]"
                          />
                        ) : (
                          <span className="tabular-nums font-medium text-slate-800">{money(lib)}</span>
                        )}
                      </td>
                      <td className={`px-2 py-2 text-right text-xs tabular-nums ${d > 0 ? "font-semibold text-emerald-700" : d < 0 ? "font-semibold text-red-600" : "text-slate-300"}`}>
                        {d === 0 ? "—" : (d > 0 ? "+" : "") + money(d)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <input
                          value={net[h.entryId] ?? ""}
                          onChange={(e) => setNet((n) => ({ ...n, [h.entryId]: e.target.value }))}
                          placeholder="se veio líquido"
                          className="w-28 rounded border border-slate-200 px-2 py-1 text-right text-xs tabular-nums outline-none focus:border-[#1f3a5f]"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 text-sm font-bold text-slate-800">
                  <td className="px-2 py-2">Total</td>
                  <td className="px-2 py-2 text-right tabular-nums">{money(batch.totalRequested)}</td>
                  <td className="px-2 py-2 text-right tabular-nums text-emerald-700">{money(totLib)}</td>
                  <td className={`px-2 py-2 text-right tabular-nums ${totDelta > 0 ? "text-emerald-700" : totDelta < 0 ? "text-red-600" : "text-slate-400"}`}>
                    {totDelta === 0 ? "—" : (totDelta > 0 ? "+" : "") + money(totDelta)}
                  </td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            Casa sem valor (liberado 0) fica <b>aguardando</b> (liberação parcial). O que o banco liberou
            a maior reduz o drawable futuro de cada casa automaticamente.
          </p>

          {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}

          <div className="mt-4 flex items-center justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">
              Cancelar
            </button>
            <button type="button" onClick={submit} disabled={pending} className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60">
              {pending ? "Registrando…" : `Registrar liberação (${batch.houses.filter((h) => (released[h.entryId] ?? 0) > 0).length} casas)`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
