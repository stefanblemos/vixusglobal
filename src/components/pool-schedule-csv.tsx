"use client";

// Export CSV do Cronograma (padrão dos ledgers): colunas casa, marco, previsto, real, delta.
export function PoolScheduleCsv({
  rows,
}: {
  rows: Array<{ casa: string; marco: string; previsto: string; real: string; deltaDias: string }>;
}) {
  const csv = () => {
    const lines = [
      ["casa", "marco", "previsto", "real", "delta_dias"].join(","),
      ...rows.map((r) =>
        [`"${r.casa.replace(/"/g, '""')}"`, r.marco, r.previsto, r.real, r.deltaDias].join(","),
      ),
    ];
    const blob = new Blob(["﻿" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "cronograma.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <button
      type="button"
      onClick={csv}
      className="rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
    >
      ⬇ CSV
    </button>
  );
}
