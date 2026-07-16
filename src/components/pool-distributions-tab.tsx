"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import Link from "next/link";
import { addDistribution, deleteDistribution, type FormState } from "@/lib/actions/pools";

// Distribuições (mock UX 6/6 aprovado): resumo por tipo, painel colapsado com PREVIEW do
// rateio pro rata antes de confirmar, linha expansível com o rateio por sócio.

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

export type DistRow = {
  id: string;
  date: string;
  kind: "RETURN_OF_CAPITAL" | "PROFIT";
  total: number;
  house: { id: string; address: string } | null;
  memo: string | null;
  lines: Array<{ name: string; amount: number }>;
};

export type DistMember = { name: string; units: number };

// espelha o rateio do server: pro rata por units, 2 casas, resíduo na maior posição
function splitPreview(total: number, members: DistMember[]) {
  const totalUnits = members.reduce((s, m) => s + m.units, 0);
  if (totalUnits <= 0 || total <= 0) return [];
  const lines = members
    .filter((m) => m.units > 0)
    .map((m) => ({ ...m, amount: Math.round((total * m.units) / totalUnits * 100) / 100 }));
  const allocated = lines.reduce((s, l) => s + l.amount, 0);
  const residue = Math.round((total - allocated) * 100) / 100;
  if (residue !== 0 && lines.length > 0) {
    const biggest = lines.reduce((a, b) => (a.amount >= b.amount ? a : b));
    biggest.amount = Math.round((biggest.amount + residue) * 100) / 100;
  }
  return lines;
}

export function PoolDistributionsTab({
  poolId,
  rows,
  houses,
  members,
}: {
  poolId: string;
  rows: DistRow[];
  houses: Array<{ id: string; address: string }>;
  members: DistMember[]; // posição atual (units > 0) — preview; o rateio final usa as units na data
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    addDistribution.bind(null, poolId),
    undefined,
  );
  const [kind, setKind] = useState<"RETURN_OF_CAPITAL" | "PROFIT">("RETURN_OF_CAPITAL");
  const [total, setTotal] = useState("");

  const totals = useMemo(() => {
    const of = (k: string) => rows.filter((r) => r.kind === k).reduce((s, r) => s + r.total, 0);
    return { all: rows.reduce((s, r) => s + r.total, 0), roc: of("RETURN_OF_CAPITAL"), profit: of("PROFIT") };
  }, [rows]);

  const totalN = Number(total.replace(/,/g, "")) || 0;
  const preview = useMemo(() => splitPreview(totalN, members), [totalN, members]);
  const totalUnits = members.reduce((s, m) => s + m.units, 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Distribuições</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Retorno de capital e lucro, rateados pro rata às units na data.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition ${
              open ? "border-[#1f3a5f] bg-blue-50 text-[#1f3a5f]" : "border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            + Distribuição
          </button>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2.5">
          {(
            [
              ["Total distribuído", totals.all],
              ["Retorno de capital", totals.roc],
              ["Lucro", totals.profit],
            ] as Array<[string, number]>
          ).map(([label, v]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
              <div className="text-[10px] font-medium uppercase tracking-wider text-slate-400">{label}</div>
              <div className="mt-0.5 text-lg font-bold tabular-nums text-slate-800">
                {v > 0 ? money(v) : "$0"}
              </div>
            </div>
          ))}
        </div>

        {open && (
          <form action={formAction} className="mt-3 rounded-lg border border-blue-100 bg-slate-50 p-4">
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-44">
                <label className={labelClass}>Tipo</label>
                <select
                  name="kind"
                  value={kind}
                  onChange={(e) => setKind(e.target.value as never)}
                  className={inputClass}
                >
                  <option value="RETURN_OF_CAPITAL">Retorno de capital</option>
                  <option value="PROFIT">Lucro</option>
                </select>
              </div>
              <div className="w-36">
                <label className={labelClass}>Total $</label>
                <input name="totalAmount" value={total} onChange={(e) => setTotal(e.target.value)} required className={inputClass} />
              </div>
              <div className="w-40">
                <label className={labelClass}>Data</label>
                <input name="date" type="date" required className={inputClass} />
              </div>
              <div className="min-w-44 flex-1">
                <label className={labelClass}>Da venda de (opcional)</label>
                <select name="houseId" defaultValue="" className={inputClass}>
                  <option value="">—</option>
                  {houses.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.address}
                    </option>
                  ))}
                </select>
              </div>
              <div className="min-w-40 flex-1">
                <label className={labelClass}>Memo</label>
                <input name="memo" className={inputClass} />
              </div>
              <button
                type="submit"
                disabled={pending || preview.length === 0}
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
              >
                {pending ? "Distribuindo…" : "Confirmar distribuição"}
              </button>
            </div>

            {/* preview do rateio ANTES de confirmar — sem lançar às cegas */}
            {preview.length > 0 && (
              <div className="mt-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
                <div className="text-[11px] font-semibold text-slate-500">
                  Rateio pro rata ({totalUnits.toLocaleString("en-US")} units)
                </div>
                <div className="mt-1.5 divide-y divide-dashed divide-slate-100">
                  {preview.map((l) => (
                    <div key={l.name} className="flex justify-between py-1 text-xs">
                      <span className="text-slate-600">
                        {l.name}{" "}
                        <span className="text-slate-400">({((l.units / totalUnits) * 100).toFixed(2)}%)</span>
                      </span>
                      <span className="tabular-nums font-medium text-slate-800">{money(l.amount)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between py-1 text-xs font-bold">
                    <span>Total</span>
                    <span className="tabular-nums">
                      {money(preview.reduce((s, l) => s + l.amount, 0))} ✓
                    </span>
                  </div>
                </div>
                <p className="mt-1.5 text-[10.5px] text-slate-400">
                  Preview pela posição atual — o rateio final usa as units na data escolhida.
                </p>
              </div>
            )}
            {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
          </form>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="w-8 px-3 py-2"></th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Data</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Tipo</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Total</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Da venda de</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Memo</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Sócios</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-5 py-6 text-center text-sm text-slate-400">
                  Nenhuma distribuição ainda — quando a primeira casa vender, lance aqui o retorno
                  de capital e/ou lucro.
                </td>
              </tr>
            )}
            {rows.map((d) => (
              <Row key={d.id} d={d} poolId={poolId} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// linha expansível: clica e vê o rateio por sócio + apagar (fora do caminho do clique comum)
function Row({ d, poolId }: { d: DistRow; poolId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <tr
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/60"
      >
        <td className="px-3 py-2 text-center text-xs text-slate-400">{open ? "▾" : "▸"}</td>
        <td className="px-3 py-2 text-sm text-slate-500">{d.date}</td>
        <td className="px-3 py-2">
          {d.kind === "RETURN_OF_CAPITAL" ? (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] text-slate-600">
              Retorno de capital
            </span>
          ) : (
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] text-emerald-700">Lucro</span>
          )}
        </td>
        <td className="px-3 py-2 text-right text-sm font-medium tabular-nums text-slate-800">{money(d.total)}</td>
        <td className="px-3 py-2">
          {d.house ? (
            <Link
              href={`/pools/${poolId}/houses/${d.house.id}`}
              onClick={(e) => e.stopPropagation()}
              className="rounded-full bg-blue-50 px-2 py-0.5 text-[10.5px] font-medium text-[#1f3a5f] hover:bg-blue-100"
            >
              {d.house.address}
            </Link>
          ) : (
            <span className="text-xs text-slate-300">—</span>
          )}
        </td>
        <td className="px-3 py-2 text-xs text-slate-400">{d.memo ?? ""}</td>
        <td className="px-3 py-2 text-right text-sm tabular-nums text-slate-500">{d.lines.length}</td>
      </tr>
      {open && (
        <tr className="border-b border-slate-100 bg-slate-50/50">
          <td></td>
          <td colSpan={6} className="px-3 py-3">
            <div className="max-w-md divide-y divide-dashed divide-slate-100">
              {d.lines.map((l) => (
                <div key={l.name} className="flex justify-between py-1 text-xs">
                  <span className="text-slate-600">{l.name}</span>
                  <span className="tabular-nums font-medium text-slate-800">{money(l.amount)}</span>
                </div>
              ))}
            </div>
            <form action={deleteDistribution} className="mt-2">
              <input type="hidden" name="distributionId" value={d.id} />
              <button type="submit" className="text-[11px] text-slate-300 underline hover:text-red-600">
                apagar esta distribuição
              </button>
            </form>
          </td>
        </tr>
      )}
    </>
  );
}
