"use client";

import { useState } from "react";

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-1.5 text-sm text-slate-600";
const tdRight = "px-3 py-1.5 text-right text-sm tabular-nums text-slate-700";

export type LedgerRow = {
  day: number;
  kindLabel: string;
  kind: string;
  label: string;
  amount: number;
  bankAmount: number | null;
  cash: number;
  bankBalance: number;
  invested: number;
  paidFromCash: boolean;
};

const money = (v: number) =>
  `${v < 0 ? "-" : ""}$${Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;

// Ledger da simulação com filtro por mês (M1..Mn) ou todos os períodos.
export function SimLedger({ rows, isBank }: { rows: LedgerRow[]; isBank: boolean }) {
  const [month, setMonth] = useState<string>("all");
  const months = [...new Set(rows.map((r) => Math.floor(r.day / 30) + 1))].sort((a, b) => a - b);
  const visible = month === "all" ? rows : rows.filter((r) => Math.floor(r.day / 30) + 1 === Number(month));

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-end justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-medium text-slate-800">
            Ledger de simulação{isBank ? " — capital próprio × banco" : ""}
          </h2>
          <p className="text-xs text-slate-400">
            {isBank
              ? "O dinheiro do banco entra no caixa e sai pagando a obra (duas linhas); fees e reserve capitalizam no saldo do loan. Contas pagas do caixa (verde) não geram aporte."
              : "Todos os eventos datados — o extrato prospectivo enviado ao investidor. Contas pagas do caixa (verde) não geram aporte."}
          </p>
        </div>
        <select
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f]"
        >
          <option value="all">Todos os períodos</option>
          {months.map((m) => (
            <option key={m} value={m}>
              Mês {m} (D+{(m - 1) * 30}–{m * 30 - 1})
            </option>
          ))}
        </select>
      </div>
      <div className="max-h-160 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-white">
            <tr className="border-b border-slate-100">
              <th className={th}>Dia</th>
              <th className={th}>Tipo</th>
              <th className={th}>Evento</th>
              <th className={thRight}>Valor</th>
              {isBank && <th className={thRight}>Δ loan</th>}
              <th className={thRight}>Caixa</th>
              {isBank && <th className={thRight}>Saldo loan</th>}
              <th className={thRight}>Capital investidor</th>
            </tr>
          </thead>
          <tbody>
            {visible.length === 0 && (
              <tr>
                <td colSpan={isBank ? 8 : 6} className="px-5 py-6 text-center text-sm text-slate-400">
                  Nenhum evento neste período.
                </td>
              </tr>
            )}
            {visible.map((e, i) => (
              <tr
                key={i}
                className={`border-b border-slate-50 ${
                  e.kind === "INJECTION"
                    ? "bg-red-50/40"
                    : e.kind === "RETURN"
                      ? "bg-emerald-50/40"
                      : e.paidFromCash
                        ? "bg-emerald-50/20"
                        : e.kind === "BANK_DRAW" || (e.kind === "BANK_CTC" && e.amount > 0)
                          ? "bg-blue-50/30"
                          : ""
                }`}
              >
                <td className={td}>D+{e.day}</td>
                <td className={td}>
                  <span className="text-xs text-slate-500">{e.kindLabel}</span>
                </td>
                <td className={`${td} text-slate-500`}>
                  {e.label}
                  {e.paidFromCash && (
                    <span
                      className="ml-1 text-xs text-emerald-600"
                      title="Havia caixa — nenhum aporte foi necessário"
                    >
                      · pago do caixa
                    </span>
                  )}
                </td>
                <td
                  className={`${tdRight} ${e.amount < 0 ? "text-slate-700" : e.amount > 0 ? "text-emerald-700" : "text-slate-300"}`}
                >
                  {e.amount !== 0 ? money(e.amount) : "—"}
                </td>
                {isBank && (
                  <td className={`${tdRight} ${(e.bankAmount ?? 0) < 0 ? "text-emerald-700" : "text-slate-500"}`}>
                    {e.bankAmount ? money(e.bankAmount) : ""}
                  </td>
                )}
                <td className={tdRight}>{money(e.cash)}</td>
                {isBank && <td className={`${tdRight} font-medium`}>{money(e.bankBalance)}</td>}
                <td className={tdRight}>{money(e.invested)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
