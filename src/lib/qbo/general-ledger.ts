import Papa from "papaparse";
import { parseQboNumber } from "./numbers";

// Parser do relatório "General Ledger" do QBO — transação a transação,
// organizado por conta. Diferente do BS/P&L (que é hierarquia de saldos).

export interface GlTransaction {
  account: string; // conta (folha) onde a linha está
  date: string; // ISO YYYY-MM-DD
  type: string; // Expense, Check, Journal Entry, Deposit, ...
  num: string | null;
  name: string | null; // vendor / cliente / contraparte
  description: string | null;
  split: string | null; // conta/categoria do outro lado (contrapartida)
  amount: string | null; // decimal-string (sinalizado)
}

export interface GeneralLedger {
  companyName: string;
  periodLabel: string;
  currency: string;
  accounts: string[];
  transactions: GlTransaction[];
}

const TOTAL_RE = /^total\s+(?:for|para)\s+/i;
const DATE_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$/;

const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ");

function detectCurrency(text: string): string {
  if (/R\$/.test(text)) return "BRL";
  if (/€/.test(text)) return "EUR";
  if (/£/.test(text)) return "GBP";
  return "USD";
}

function toIso(mdy: string): string {
  const m = mdy.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return mdy;
  return `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`;
}

export function parseGeneralLedger(csvText: string): GeneralLedger {
  const rows = (Papa.parse<string[]>(csvText, { skipEmptyLines: false }).data ?? []).map((r) =>
    (r ?? []).map((c) => decodeEntities((c ?? "").trim())),
  );

  const companyName = rows[0]?.[0] ?? "";
  const periodLabel = rows[2]?.[0] ?? "";

  // Cabeçalho de colunas = a linha que tem "Transaction Date" em alguma coluna.
  // O QBO exporta o GL em dois layouts — com e sem a coluna "Distribution account" —
  // então mapeamos cada coluna pelo RÓTULO, não por índice fixo (senão tudo desloca).
  const headerIdx = rows.findIndex((r) =>
    r.some((c) => (c ?? "").toLowerCase() === "transaction date"),
  );
  const header = headerIdx >= 0 ? rows[headerIdx] : [];
  const find = (pred: (c: string) => boolean) => {
    const i = header.findIndex((c) => pred((c ?? "").toLowerCase()));
    return i >= 0 ? i : null;
  };
  const dateIdx = find((c) => c === "transaction date") ?? 1;
  const typeIdx = find((c) => c === "transaction type") ?? dateIdx + 1;
  const numIdx = find((c) => c === "num" || c === "#") ?? dateIdx + 2;
  const nameIdx = find((c) => c === "name") ?? dateIdx + 3;
  const descIdx = find((c) => c.includes("memo") || c.includes("description")) ?? dateIdx + 4;
  const splitIdx = find((c) => c === "split") ?? dateIdx + 5;
  const amountIdx = find((c) => c === "amount") ?? dateIdx + 6;
  // Coluna que repete o nome da conta em cada linha (layout novo). Pode não existir.
  const acctIdx = find((c) => c.includes("distribution account") || c === "account");

  const transactions: GlTransaction[] = [];
  const accounts = new Set<string>();
  let currentAccount = "";

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const c0 = row[0] ?? "";
    if (/^(accrual|cash)\s+basis/i.test(c0)) break;

    const date = row[dateIdx] ?? "";
    const isTxn = DATE_RE.test(date);

    if (!isTxn) {
      // cabeçalho de conta (define a conta atual); total / "Beginning Balance" → ignora
      if (c0 && !TOTAL_RE.test(c0) && !/^beginning balance$/i.test(c0)) {
        currentAccount = c0;
        accounts.add(c0);
      }
      continue;
    }

    // Conta: preferir a coluna por linha (layout novo); senão, o cabeçalho de seção.
    const rowAccount = acctIdx != null ? (row[acctIdx] ?? "").trim() : "";
    const account = rowAccount || currentAccount;
    if (account) accounts.add(account);

    transactions.push({
      account,
      date: toIso(date),
      type: row[typeIdx] ?? "",
      num: row[numIdx] || null,
      name: row[nameIdx] || null,
      description: row[descIdx] || null,
      split: row[splitIdx] || null,
      amount: parseQboNumber(row[amountIdx]),
    });
  }

  return {
    companyName,
    periodLabel,
    currency: detectCurrency(csvText),
    accounts: [...accounts],
    transactions,
  };
}
