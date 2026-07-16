"use client";

import { useMemo, useState } from "react";
import { deleteContribution } from "@/lib/actions/pools";

// Capital ledger (mock UX 6/6 aprovado): filtros por tipo e sócio, captado acumulado,
// transferência pareada numa linha (de → para), CSV, apagar atrás do menu ··· (auditoria).

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export type LedgerRow = {
  id: string; // id de um dos lançamentos (transfer: apagar remove os dois lados)
  date: string;
  kind: "CONTRIBUTION" | "CAPITAL_CALL" | "TRANSFER" | "TRANSFER_IN" | "TRANSFER_OUT";
  memberName: string; // transfer pareada: "De → Para"
  amount: number;
  units: number;
  cumulative: number; // captado acumulado (transferência não muda)
  memo: string | null;
  memberIds: string[]; // p/ filtro por sócio (transfer: os dois lados)
};

const KIND_LABEL: Record<string, { label: string; cls: string }> = {
  CONTRIBUTION: { label: "Aporte", cls: "bg-blue-50 text-[#1f3a5f]" },
  CAPITAL_CALL: { label: "Capital call", cls: "bg-emerald-50 text-emerald-700" },
  TRANSFER: { label: "Transferência", cls: "bg-violet-50 text-violet-700" },
  TRANSFER_IN: { label: "Transfer in", cls: "bg-violet-50 text-violet-700" },
  TRANSFER_OUT: { label: "Transfer out", cls: "bg-violet-50 text-violet-700" },
};

const isTransfer = (k: string) => k.startsWith("TRANSFER");

export function PoolLedgerTab({
  poolId,
  rows,
  members,
  raised,
  totalUnits,
}: {
  poolId: string;
  rows: LedgerRow[];
  members: Array<{ id: string; name: string }>;
  raised: number;
  totalUnits: number;
}) {
  const [kind, setKind] = useState<"ALL" | "CONTRIBUTION" | "TRANSFER" | "CAPITAL_CALL">("ALL");
  const [memberId, setMemberId] = useState("");

  const counts = useMemo(
    () => ({
      contribution: rows.filter((r) => r.kind === "CONTRIBUTION").length,
      transfer: rows.filter((r) => isTransfer(r.kind)).length,
      call: rows.filter((r) => r.kind === "CAPITAL_CALL").length,
    }),
    [rows],
  );

  const filtered = rows.filter(
    (r) =>
      (kind === "ALL" ||
        (kind === "TRANSFER" ? isTransfer(r.kind) : r.kind === kind)) &&
      (!memberId || r.memberIds.includes(memberId)),
  );

  const csv = () => {
    const lines = [
      ["data", "socio", "tipo", "valor", "units", "captado_acumulado", "memo"].join(","),
      ...filtered.map((r) =>
        [
          r.date,
          `"${r.memberName.replace(/"/g, '""')}"`,
          KIND_LABEL[r.kind]?.label ?? r.kind,
          r.amount.toFixed(2),
          r.units.toFixed(2),
          r.cumulative.toFixed(2),
          `"${(r.memo ?? "").replace(/"/g, '""')}"`,
        ].join(","),
      ),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "capital-ledger.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const pill = (v: typeof kind, label: string, count: number) => (
    <button
      key={v}
      type="button"
      onClick={() => setKind(v)}
      className={`rounded-full px-3 py-1 text-[11.5px] transition ${
        kind === v ? "bg-[#1f3a5f] font-semibold text-white" : "bg-slate-100 text-slate-500 hover:bg-slate-200"
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
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Capital ledger</h2>
            <p className="mt-0.5 text-xs text-slate-400">
              Cada aporte e transferência, em ordem — a fonte dos statements dos investidores.
            </p>
          </div>
          <button
            type="button"
            onClick={csv}
            className="rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            ⬇ CSV
          </button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          {pill("ALL", "Tudo", rows.length)}
          {pill("CONTRIBUTION", "Aportes", counts.contribution)}
          {pill("TRANSFER", "Transferências", counts.transfer)}
          {pill("CAPITAL_CALL", "Capital calls", counts.call)}
          <select
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            className="ml-auto rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs text-slate-600 outline-none focus:border-[#1f3a5f]"
          >
            <option value="">Todos os sócios</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Data</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Sócio</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Tipo</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Valor</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Units</th>
              <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Captado acum.</th>
              <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Memo</th>
              <th className="px-2 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-center text-sm text-slate-400">
                  {rows.length === 0 ? "Nenhum lançamento ainda." : "Nada neste filtro."}
                </td>
              </tr>
            )}
            {filtered.map((r) => (
              <tr key={r.id} className={`border-b border-slate-50 ${isTransfer(r.kind) ? "bg-violet-50/30" : ""}`}>
                <td className="px-4 py-2 text-sm text-slate-500">{r.date}</td>
                <td className="px-3 py-2 text-sm font-medium text-slate-800">{r.memberName}</td>
                <td className="px-3 py-2">
                  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] ${KIND_LABEL[r.kind]?.cls ?? ""}`}>
                    {KIND_LABEL[r.kind]?.label ?? r.kind}
                  </span>
                </td>
                <td className="px-3 py-2 text-right text-sm tabular-nums text-slate-700">{money(r.amount)}</td>
                <td className="px-3 py-2 text-right text-sm tabular-nums text-slate-700">
                  {r.units.toLocaleString("en-US")}
                </td>
                <td className="px-3 py-2 text-right text-[11.5px] tabular-nums text-slate-400">
                  {money(r.cumulative)}
                  {isTransfer(r.kind) && <span title="transferência não muda o captado"> ＝</span>}
                </td>
                <td className="px-3 py-2 text-xs text-slate-400">{r.memo ?? ""}</td>
                <td className="px-2 py-2 text-right">
                  {/* correção fica atrás do ··· — trilha de auditoria, sem ✕ exposto */}
                  <details className="relative">
                    <summary className="cursor-pointer list-none px-1 text-slate-300 hover:text-slate-500">···</summary>
                    <div className="absolute right-0 z-10 mt-1 w-52 rounded-lg border border-slate-200 bg-white p-3 text-left shadow-lg">
                      <p className="text-[11px] text-slate-400">
                        {isTransfer(r.kind)
                          ? "Apaga a transferência inteira (os dois lados)."
                          : "Apaga este lançamento do ledger."}
                      </p>
                      <form action={deleteContribution} className="mt-2">
                        <input type="hidden" name="entryId" value={r.id} />
                        <input type="hidden" name="poolId" value={poolId} />
                        <button
                          type="submit"
                          className="w-full rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                        >
                          Apagar lançamento
                        </button>
                      </form>
                    </div>
                  </details>
                </td>
              </tr>
            ))}
            {filtered.length > 0 && (
              <tr className="bg-slate-50/60 font-semibold">
                <td colSpan={3} className="px-4 py-2 text-sm text-slate-800">
                  Captado hoje
                </td>
                <td className="px-3 py-2 text-right text-sm tabular-nums">{money(raised)}</td>
                <td className="px-3 py-2 text-right text-sm tabular-nums">{totalUnits.toLocaleString("en-US")}</td>
                <td colSpan={3}></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
