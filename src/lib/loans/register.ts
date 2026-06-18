import * as XLSX from "xlsx";

// Lê um "register" (extrato de conta) exportado do QBO para um empréstimo — ex.:
// "Loans to Others : Truss Direct, LLC". Importa FIELMENTE o que está na planilha
// (.xls/.xlsx/.csv): cada linha vira uma transação. Não inventa juro nem reclassifica.

export type RegisterRow = {
  date: Date | null;
  ref: string;
  payee: string;
  memo: string;
  decrease: number | null; // saída do saldo (amortização recebida)
  increase: number | null; // entrada no saldo (desembolso/empréstimo)
  balance: number | null; // saldo corrente informado pela planilha
  type: string; // Deposit | Expense | Journal | ...
};

export type LoanRegister = {
  accountName: string;
  endingBalance: number | null;
  rows: RegisterRow[]; // ordem cronológica (mais antiga primeiro)
};

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(String(v).replace(/[$\s,]/g, "").replace(/^\((.*)\)$/, "-$1"));
  return Number.isFinite(n) ? n : null;
};

// Datas vêm como "MM/DD/YYYY" (texto) ou serial do Excel.
const parseDate = (v: unknown): Date | null => {
  if (v == null || v === "") return null;
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    return d ? new Date(Date.UTC(d.y, d.m - 1, d.d)) : null;
  }
  const m = String(v).match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (m) {
    const yr = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return new Date(Date.UTC(yr, Number(m[1]) - 1, Number(m[2])));
  }
  return null;
};

const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();

export function parseLoanRegister(buf: Buffer | Uint8Array): LoanRegister {
  const wb = XLSX.read(buf, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false, defval: "" });

  // Cabeçalho do relatório (nome da conta + saldo final) nas primeiras linhas.
  let accountName = "";
  let endingBalance: number | null = null;
  for (let i = 0; i < Math.min(grid.length, 5); i++) {
    const line = (grid[i] ?? []).map((c) => String(c ?? "")).join(" ");
    const acc = line.match(/loans?\s+(?:to|from)\s+others?\s*:\s*([^\t]+?)(?:\s{2,}|ending balance|$)/i);
    if (acc && !accountName) accountName = acc[1].trim().replace(/\s+/g, " ");
    const eb = line.match(/ending balance[:\s]*\$?\s*([\d,]+\.?\d*)/i);
    if (eb) endingBalance = num(eb[1]);
  }

  // Linha de colunas: contém "Date" e "Balance".
  const headerIdx = grid.findIndex(
    (r) => r.some((c) => norm(c) === "date") && r.some((c) => norm(c) === "balance"),
  );
  if (headerIdx < 0) return { accountName, endingBalance, rows: [] };

  const header = (grid[headerIdx] ?? []).map(norm);
  const col = (name: string) => header.findIndex((h) => h === name);
  const ci = {
    date: col("date"),
    ref: col("ref no."),
    payee: col("payee"),
    memo: col("memo"),
    decrease: col("decrease"),
    increase: col("increase"),
    balance: col("balance"),
    type: col("type"),
  };

  const rows: RegisterRow[] = [];
  for (let i = headerIdx + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    const date = parseDate(r[ci.date]);
    const decrease = num(r[ci.decrease]);
    const increase = num(r[ci.increase]);
    if (!date && decrease == null && increase == null) continue; // linha vazia
    rows.push({
      date,
      ref: String(r[ci.ref] ?? "").trim(),
      payee: String(r[ci.payee] ?? "").trim(),
      memo: String(r[ci.memo] ?? "").trim(),
      decrease,
      increase,
      balance: num(r[ci.balance]),
      type: String(r[ci.type] ?? "").trim(),
    });
  }

  // O QBO exporta do mais recente para o mais antigo — invertendo a ordem do arquivo fica
  // cronológico E preserva a ordem dentro do mesmo dia (o que ordenar por data quebraria).
  rows.reverse();
  return { accountName, endingBalance, rows };
}
