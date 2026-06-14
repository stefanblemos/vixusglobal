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
  const headerIdx = rows.findIndex((r) => (r[1] ?? "").toLowerCase() === "transaction date");

  const transactions: GlTransaction[] = [];
  const accounts = new Set<string>();
  let currentAccount = "";

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const c0 = row[0] ?? "";
    if (/^(accrual|cash)\s+basis/i.test(c0)) break;

    const date = row[1] ?? "";
    const isTxn = DATE_RE.test(date);

    if (!isTxn) {
      // cabeçalho de conta (define a conta atual) ou linha de total (ignora)
      if (c0 && !TOTAL_RE.test(c0)) {
        currentAccount = c0;
        accounts.add(c0);
      }
      continue;
    }

    transactions.push({
      account: currentAccount,
      date: toIso(date),
      type: row[2] ?? "",
      num: row[3] || null,
      name: row[4] || null,
      description: row[5] || null,
      split: row[6] || null,
      amount: parseQboNumber(row[7]),
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
