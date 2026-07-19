"use client";

import { useActionState, useMemo, useState } from "react";
import Link from "next/link";
import { AddHouseForm } from "@/components/pool-house-form";
import { requestBatchDraw } from "@/lib/actions/milestones";

// Aba Casas (mock UX 4/6 aprovado): filtro por status + busca, contexto (modelo · local ·
// banco) na linha, capital próprio com % do previsto, pendências por casa, + Casa colapsado.
// Apagar casa saiu da lista — vive na ficha, longe do clique acidental.

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export type HouseRow = {
  id: string;
  address: string;
  status: string;
  buildPct: number | null; // % de obra pelos draws creditados (CO = 100%)
  model: string | null;
  location: string | null;
  bank: string | null;
  plannedProfit: number | null;
  ownCapital: number | null;
  ownNeeded: number | null; // custo pro forma − loan (referência do % usado)
  soldPrice: number | null;
  received: number | null;
  realProfit: number | null;
  pending: number; // campos reais vazios (mesma régua da ficha)
};

const STATUS_LABEL: Record<string, string> = {
  PLANNED: "Planned",
  LOT_PURCHASED: "Lot purchased",
  UNDER_CONSTRUCTION: "Construction",
  FOR_SALE: "For sale",
  UNDER_CONTRACT: "Under contract",
  SOLD: "Sold",
};

const STATUS_STYLE: Record<string, string> = {
  PLANNED: "bg-slate-100 text-slate-500",
  LOT_PURCHASED: "bg-amber-50 text-amber-700",
  UNDER_CONSTRUCTION: "bg-amber-50 text-amber-700",
  FOR_SALE: "bg-blue-50 text-blue-700",
  UNDER_CONTRACT: "bg-blue-50 text-blue-700",
  SOLD: "bg-emerald-50 text-emerald-700",
};

// Draw em lote (#73): requisita o draw estimado de todas as casas com % de obra acima do já
// sacado, uma submissão só ("pool de draw"). Cria draws pendentes por casa no loan.
function BatchDrawButton({ poolId }: { poolId: string }) {
  const [state, action, pending] = useActionState<{ error?: string; ok?: boolean } | undefined, FormData>(
    requestBatchDraw,
    undefined,
  );
  return (
    <form action={action} className="flex items-center gap-2">
      <input type="hidden" name="poolId" value={poolId} />
      <button
        type="submit"
        disabled={pending}
        title="Requisita o draw estimado de todas as casas com obra à frente do sacado"
        className="rounded-lg border border-[#1f3a5f] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#1f3a5f] hover:bg-blue-50 disabled:opacity-50"
      >
        {pending ? "Requisitando…" : "📤 Draw em lote"}
      </button>
      {state?.error && <span className="text-[11px] text-red-600">{state.error}</span>}
      {state?.ok && <span className="text-[11px] text-emerald-700">✓ requisitado</span>}
    </form>
  );
}

export function PoolHousesTab({
  poolId,
  rows,
  initialStatus,
}: {
  poolId: string;
  rows: HouseRow[];
  initialStatus: string | null; // vem do board da Overview (?tab=houses&status=X)
}) {
  const [status, setStatus] = useState<string | null>(
    initialStatus && STATUS_LABEL[initialStatus] ? initialStatus : null,
  );
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(
    () =>
      rows.filter(
        (r) =>
          (!status || r.status === status) &&
          (!q.trim() || r.address.toLowerCase().includes(q.trim().toLowerCase())),
      ),
    [rows, status, q],
  );
  // "Recebido" só ocupa espaço quando existe (alguma casa vendida/recebida)
  const showReceived = rows.some((r) => r.received != null);

  const totals = useMemo(() => {
    const sum = (f: (r: HouseRow) => number | null) =>
      filtered.reduce((s, r) => s + (f(r) ?? 0), 0);
    const any = (f: (r: HouseRow) => number | null) => filtered.some((r) => f(r) != null);
    return {
      plannedProfit: any((r) => r.plannedProfit) ? sum((r) => r.plannedProfit) : null,
      ownCapital: any((r) => r.ownCapital) ? sum((r) => r.ownCapital) : null,
      soldPrice: any((r) => r.soldPrice) ? sum((r) => r.soldPrice) : null,
      received: any((r) => r.received) ? sum((r) => r.received) : null,
      realProfit: any((r) => r.realProfit) ? sum((r) => r.realProfit) : null,
    };
  }, [filtered]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [rows]);

  const pill = (value: string | null, label: string, count: number) => (
    <button
      key={value ?? "all"}
      type="button"
      onClick={() => setStatus(value)}
      className={`rounded-full px-3 py-1 text-[11.5px] transition ${
        status === value
          ? "bg-[#1f3a5f] font-semibold text-white"
          : "bg-slate-100 text-slate-500 hover:bg-slate-200"
      }`}
    >
      {label} <b>{count}</b>
    </button>
  );

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Casas</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Recebido = o que entrou em conta na venda (caixa, não lucro — o payoff do sweep
              amortiza o pool). Lucro (custo) = venda − closing − custos reais da casa.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <BatchDrawButton poolId={poolId} />
            <button
              type="button"
              onClick={() => setAdding((v) => !v)}
              className={`rounded-lg border px-3.5 py-1.5 text-xs font-semibold transition ${
                adding
                  ? "border-[#1f3a5f] bg-blue-50 text-[#1f3a5f]"
                  : "border-slate-300 text-slate-600 hover:bg-slate-50"
              }`}
            >
              + Casa
            </button>
          </div>
        </div>
        {adding && (
          <div className="mt-3 rounded-lg border border-blue-100 bg-slate-50 p-4">
            <AddHouseForm poolId={poolId} />
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {pill(null, "Todas", rows.length)}
          {Object.entries(STATUS_LABEL).map(([v, l]) => pill(v, l, counts[v] ?? 0))}
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="🔍 endereço…"
            className="ml-auto w-48 rounded-lg border border-slate-300 px-3 py-1.5 text-xs outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400" style={{ width: "30%" }}>
                Casa
              </th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Status</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Lucro previsto</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Capital próprio</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Venda</th>
              {showReceived && (
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Recebido</th>
              )}
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Lucro (custo)</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={showReceived ? 8 : 7} className="px-5 py-6 text-center text-sm text-slate-400">
                  {rows.length === 0
                    ? "Nenhuma casa ainda — adicione a primeira em + Casa."
                    : "Nenhuma casa neste filtro."}
                </td>
              </tr>
            )}
            {filtered.map((r) => {
              const pct =
                r.ownCapital != null && r.ownNeeded != null && r.ownNeeded > 0
                  ? Math.round((r.ownCapital / r.ownNeeded) * 100)
                  : null;
              return (
                <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                  <td className="px-4 py-2.5">
                    <Link
                      href={`/pools/${poolId}/houses/${r.id}`}
                      className="text-sm font-semibold text-[#1f3a5f] hover:underline"
                    >
                      {r.address}
                    </Link>
                    <div className="mt-0.5 text-[10.5px] text-slate-400">
                      {[r.model, r.location].filter(Boolean).join(" · ") || "modelo a definir"}
                      {r.bank ? ` · 🏦 ${r.bank}` : ""}
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[r.status] ?? ""}`}>
                      {STATUS_LABEL[r.status] ?? r.status}
                      {r.status === "UNDER_CONSTRUCTION" && r.buildPct != null && (
                        <b> · {r.buildPct}%</b>
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-700">
                    {r.plannedProfit != null ? money(r.plannedProfit) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-700">
                    {r.ownCapital != null ? money(r.ownCapital) : "—"}
                    {pct != null && (
                      <div className={`text-[10.5px] ${pct > 100 ? "font-bold text-red-700" : "text-slate-400"}`}>
                        {pct}% do previsto{pct > 100 ? " ⚠" : ""}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-700">
                    {r.soldPrice != null ? money(r.soldPrice) : "—"}
                  </td>
                  {showReceived && (
                    <td className="px-3 py-2.5 text-right text-sm tabular-nums text-slate-700">
                      {r.received != null ? money(r.received) : "—"}
                    </td>
                  )}
                  <td
                    className={`px-3 py-2.5 text-right text-sm tabular-nums ${
                      r.realProfit == null ? "text-slate-400" : r.realProfit < 0 ? "text-red-600" : "text-emerald-700"
                    }`}
                  >
                    {r.realProfit != null ? money(r.realProfit) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {r.pending > 0 && (
                      <span className="whitespace-nowrap rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">
                        {r.pending} {r.pending === 1 ? "pendente" : "pendentes"}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length > 0 && (
              <tr className="bg-slate-50/60">
                <td className="px-4 py-2 text-sm font-semibold text-slate-800">
                  Total ({filtered.length} {filtered.length === 1 ? "casa" : "casas"}
                  {status || q ? " no filtro" : ""})
                </td>
                <td></td>
                <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                  {totals.plannedProfit != null ? money(totals.plannedProfit) : "—"}
                </td>
                <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                  {totals.ownCapital != null ? money(totals.ownCapital) : "—"}
                </td>
                <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                  {totals.soldPrice != null ? money(totals.soldPrice) : "—"}
                </td>
                {showReceived && (
                  <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                    {totals.received != null ? money(totals.received) : "—"}
                  </td>
                )}
                <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                  {totals.realProfit != null ? money(totals.realProfit) : "—"}
                </td>
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
