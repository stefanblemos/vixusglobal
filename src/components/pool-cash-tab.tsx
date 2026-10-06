"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { PoolLedgerRow } from "@/lib/pools/pool-ledger";

// Aba Extrato (etapa 3, mock aprovado 05/10): todo o dinheiro do caixa do pool com saldo
// corrido; filtros por tipo e por casa; aberturas (sem data) compactadas numa linha até
// ganharem data real; CSV no cliente.

const f2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const br = (iso: string | null) => (iso ? iso.split("-").reverse().join("/") : "abertura");

const CHIPS = [
  ["ALL", "Tudo"], ["MEMBERS", "Sócios"], ["HOUSES", "Casas"], ["SALES", "Vendas"], ["EXPENSES", "Despesas"], ["DIST", "Distribuições"],
] as const;
type Filter = (typeof CHIPS)[number][0];

const SRC: Record<PoolLedgerRow["source"], [string, string]> = {
  MEMBER: ["Sócio", "bg-blue-50 text-[#1f3a5f]"],
  HOUSE: ["Casa", "bg-slate-100 text-slate-600"],
  SALE: ["Venda", "bg-emerald-50 text-emerald-700"],
  POOL: ["Pool", "bg-slate-100 text-slate-600"],
};

export function PoolCashTab({
  poolId,
  rows,
  houses,
  cash,
  totalIn,
  totalOut,
}: {
  poolId: string;
  rows: PoolLedgerRow[];
  houses: Array<{ id: string; address: string }>;
  cash: number;
  totalIn: number;
  totalOut: number;
}) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [houseId, setHouseId] = useState<string>("ALL");

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: rows.length };
    for (const r of rows) c[r.cat] = (c[r.cat] ?? 0) + 1;
    return c;
  }, [rows]);

  // saldo corrido é sobre TUDO (filtro só esconde linhas — o saldo continua sendo o do pool)
  const view = useMemo(() => {
    const collapse = houseId === "ALL";
    const openings = rows.filter((r) => r.opening);
    const out: Array<{ key: string; row: PoolLedgerRow | null; balance: number; collapsed?: { count: number; total: number } }> = [];
    let bal = 0;
    if (collapse && openings.length) {
      const total = openings.reduce((s, r) => s + (r.outAmount ?? 0), 0);
      bal -= total;
      if (filter === "ALL" || filter === "HOUSES") out.push({ key: "openings", row: null, balance: bal, collapsed: { count: openings.length, total } });
    }
    rows.forEach((r, i) => {
      if (r.opening && collapse) return;
      bal += (r.inAmount ?? 0) - (r.outAmount ?? 0);
      if (filter !== "ALL" && r.cat !== filter) return;
      if (houseId !== "ALL" && r.houseId !== houseId) return;
      out.push({ key: `r${i}`, row: r, balance: bal });
    });
    return out;
  }, [rows, filter, houseId]);

  const downloadCsv = () => {
    const head = ["data", "lancamento", "casa", "origem", "entrou", "saiu"];
    const lines = rows.map((r) => [r.date ?? "abertura", r.label, r.house ?? "pool", SRC[r.source][0], r.inAmount ?? "", r.outAmount ?? ""]);
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `extrato-pool-${poolId.slice(-6)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Extrato único do pool</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Todo o dinheiro que entrou e saiu do caixa do pool, com saldo corrido. Casa = filtro; o extrato
              da casa é um recorte deste. Movimentos do banco (draws, payoff, juros da reserve, fees) ficam na
              aba Banco.
            </p>
          </div>
          <button type="button" onClick={downloadCsv} className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
            ⬇ CSV
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {CHIPS.map(([k, l]) => (
            <button
              key={k}
              type="button"
              onClick={() => setFilter(k)}
              className={`rounded-full px-3 py-1 text-[11.5px] transition ${filter === k ? "bg-[#1f3a5f] font-semibold text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
            >
              {l} <b>{counts[k] ?? 0}</b>
            </button>
          ))}
          <select
            value={houseId}
            onChange={(e) => setHouseId(e.target.value)}
            className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1 text-xs outline-none focus:border-[#1f3a5f]"
          >
            <option value="ALL">todas as casas</option>
            {houses.map((h) => <option key={h.id} value={h.id}>{h.address}</option>)}
          </select>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 text-left text-[10.5px] uppercase tracking-wider text-slate-400">
              <th className="whitespace-nowrap px-4 py-2 font-medium">Data</th>
              <th className="px-3 py-2 font-medium">Lançamento</th>
              <th className="px-3 py-2 font-medium">Casa</th>
              <th className="px-3 py-2 font-medium">Origem</th>
              <th className="px-3 py-2 text-right font-medium">Entrou</th>
              <th className="px-3 py-2 text-right font-medium">Saiu</th>
              <th className="px-4 py-2 text-right font-medium">Saldo</th>
            </tr>
          </thead>
          <tbody className="text-[12.5px]">
            {view.length === 0 && (
              <tr><td colSpan={7} className="px-5 py-6 text-center text-slate-400">Nenhum movimento neste filtro.</td></tr>
            )}
            {view.map((v) =>
              v.collapsed ? (
                <tr key={v.key} className="border-b border-slate-50 bg-slate-50/70 text-slate-500">
                  <td className="px-4 py-2">abertura</td>
                  <td className="px-3 py-2" colSpan={2}>
                    Capital próprio colocado nas casas — <b>{v.collapsed.count} aberturas sem data</b>{" "}
                    <span className="text-slate-400">(valores da ficha antiga; escolha uma casa para ver cada uma; a data real vem pelo GL ou pelo extrato da casa)</span>
                  </td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${SRC.HOUSE[1]}`}>Casa</span></td>
                  <td></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-red-700">{f2(v.collapsed.total)}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-bold tabular-nums">{f2(v.balance)}</td>
                </tr>
              ) : (
                <tr key={v.key} className={`border-b border-slate-50 ${v.row!.opening ? "bg-slate-50/70 text-slate-500" : ""}`}>
                  <td className="whitespace-nowrap px-4 py-2 text-slate-500">{br(v.row!.date)}</td>
                  <td className="px-3 py-2 text-slate-700">{v.row!.label}</td>
                  <td className="px-3 py-2">
                    {v.row!.houseId ? (
                      <Link href={`/pools/${poolId}/houses/${v.row!.houseId}`} className="text-[#1f3a5f] hover:underline">{v.row!.house}</Link>
                    ) : (
                      <span className="text-slate-400">pool</span>
                    )}
                  </td>
                  <td className="px-3 py-2"><span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${SRC[v.row!.source][1]}`}>{SRC[v.row!.source][0]}</span></td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-emerald-700">{v.row!.inAmount != null ? f2(v.row!.inAmount) : ""}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-red-700">{v.row!.outAmount != null ? f2(v.row!.outAmount) : ""}</td>
                  <td className="whitespace-nowrap px-4 py-2 text-right font-bold tabular-nums text-slate-800">{f2(v.balance)}</td>
                </tr>
              ),
            )}
            <tr className="bg-slate-50 font-bold text-slate-800">
              <td className="px-4 py-2" colSpan={4}>Totais do pool{filter !== "ALL" || houseId !== "ALL" ? " (independem do filtro)" : ""}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{f2(totalIn)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{f2(totalOut)}</td>
              <td className="whitespace-nowrap px-4 py-2 text-right tabular-nums">{f2(cash)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}
