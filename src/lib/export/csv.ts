// Gerador de CSV mínimo (sem dependência) para exportações que o contador abre no Excel.
// Escapa aspas/《vírgula/quebra de linha; números vão crus (Excel os trata como número).

type Cell = string | number | null | undefined;

function escapeCell(v: Cell): string {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v) : v;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// Monta um CSV a partir de linhas (a 1ª costuma ser o cabeçalho). Prefixo BOM p/ o Excel abrir
// acentos em UTF-8 corretamente.
export function toCsv(rows: Cell[][]): string {
  const body = rows.map((r) => r.map(escapeCell).join(",")).join("\r\n");
  return "﻿" + body;
}

export function csvResponse(csv: string, filename: string): Response {
  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`,
    },
  });
}
