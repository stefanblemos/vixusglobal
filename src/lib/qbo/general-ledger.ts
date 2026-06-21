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

export interface GlAccountBalance {
  account: string;
  beginning: string | null; // saldo inicial (linha "Beginning Balance")
  ending: string | null; // saldo final (última coluna Balance da seção)
}

export interface GeneralLedger {
  companyName: string;
  periodLabel: string;
  currency: string;
  accounts: string[];
  accountBalances: GlAccountBalance[]; // saldos por conta — p/ cruzar com o BS
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
  // Reconhece rótulos em inglês E português (PT) — o QBO exporta no idioma da empresa.
  const isDateHeader = (c: string) => c === "transaction date" || c === "data de transação";
  const headerIdx = rows.findIndex((r) => r.some((c) => isDateHeader((c ?? "").toLowerCase())));
  const header = headerIdx >= 0 ? rows[headerIdx] : [];
  const find = (pred: (c: string) => boolean) => {
    const i = header.findIndex((c) => pred((c ?? "").toLowerCase()));
    return i >= 0 ? i : null;
  };
  const dateIdx = find(isDateHeader) ?? 1;
  const typeIdx = find((c) => c === "transaction type" || c === "tipo de transação") ?? dateIdx + 1;
  const numIdx = find((c) => c === "num" || c === "#" || c === "número") ?? dateIdx + 2;
  const nameIdx = find((c) => c === "name" || c === "nome") ?? dateIdx + 3;
  const descIdx =
    find((c) => c.includes("memo") || c.includes("description") || c.includes("descrição")) ??
    dateIdx + 4;
  const splitIdx = find((c) => c === "split" || c === "dividir") ?? dateIdx + 5;
  const amountIdx = find((c) => c === "amount" || c === "montante") ?? dateIdx + 6;
  // saldo corrido (p/ saldo final por conta)
  const balanceIdx = find((c) => c === "balance" || c === "saldo");
  // Coluna que repete o nome da conta em cada linha (layout novo). Pode não existir.
  const acctIdx = find(
    (c) => c.includes("distribution account") || c === "account" || c === "conta de distribuição",
  );

  const transactions: GlTransaction[] = [];
  const accounts = new Set<string>();
  const beginningMap = new Map<string, string | null>();
  const endingMap = new Map<string, string | null>();
  let currentAccount = "";

  const isBeginning = (row: string[]) =>
    row.some((c) => {
      const v = (c ?? "").toLowerCase();
      return v === "beginning balance" || v === "saldo inicial";
    });

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const c0 = row[0] ?? "";
    if (/^(accrual|cash)\s+basis/i.test(c0)) break;

    const date = row[dateIdx] ?? "";
    const isTxn = DATE_RE.test(date);

    if (!isTxn) {
      // "Beginning Balance" → saldo inicial da conta atual.
      if (isBeginning(row)) {
        if (currentAccount && balanceIdx != null) {
          beginningMap.set(currentAccount, parseQboNumber(row[balanceIdx]));
        }
        continue;
      }
      // cabeçalho de conta (define a conta atual); total → ignora
      if (c0 && !TOTAL_RE.test(c0)) {
        currentAccount = c0;
        accounts.add(c0);
      }
      continue;
    }

    // Conta: preferir a coluna por linha (layout novo); senão, o cabeçalho de seção.
    const rowAccount = acctIdx != null ? (row[acctIdx] ?? "").trim() : "";
    const account = rowAccount || currentAccount;
    if (account) accounts.add(account);
    // Saldo final = último saldo corrido visto na seção da conta.
    if (account && balanceIdx != null) {
      const bal = parseQboNumber(row[balanceIdx]);
      if (bal != null) endingMap.set(account, bal);
    }

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

  const accountBalances: GlAccountBalance[] = [...accounts].map((account) => ({
    account,
    beginning: beginningMap.get(account) ?? null,
    ending: endingMap.get(account) ?? beginningMap.get(account) ?? null,
  }));

  return {
    companyName,
    periodLabel,
    currency: detectCurrency(csvText),
    accounts: [...accounts],
    accountBalances,
    transactions,
  };
}
