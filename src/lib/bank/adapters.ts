import Papa from "papaparse";
import { parseQboNumber } from "@/lib/qbo/numbers";

// Extrato bancário normalizado. Cada banco tem um adaptador que sabe ler seu CSV.
export interface BankStatementLine {
  date: string; // ISO YYYY-MM-DD
  description: string;
  amount: string; // decimal-string, sinalizado (+ crédito, - débito)
  balance: string | null;
}

export interface ParsedStatement {
  beginningBalance: string | null;
  endingBalance: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  lines: BankStatementLine[];
}

export interface BankAdapter {
  id: string;
  label: string;
  parse(csvText: string): ParsedStatement;
}

const toIso = (mdy: string): string => {
  const m = mdy.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}` : mdy.trim();
};

const rowsOf = (csv: string): string[][] =>
  (Papa.parse<string[]>(csv, { skipEmptyLines: false }).data ?? []).map((r) =>
    (r ?? []).map((c) => (c ?? "").trim()),
  );

// ── Bank of America ──
// Bloco de resumo (Beginning/Ending balance), depois header "Date,Description,Amount,Running Bal."
const bankOfAmerica: BankAdapter = {
  id: "boa",
  label: "Bank of America",
  parse(csv) {
    const rows = rowsOf(csv);
    let beginningBalance: string | null = null;
    let endingBalance: string | null = null;
    let periodStart: string | null = null;
    let periodEnd: string | null = null;

    for (const r of rows) {
      const desc = r[0] ?? "";
      const begin = desc.match(/beginning balance as of (\d{1,2}\/\d{1,2}\/\d{4})/i);
      const end = desc.match(/ending balance as of (\d{1,2}\/\d{1,2}\/\d{4})/i);
      if (begin) {
        periodStart = toIso(begin[1]);
        beginningBalance = parseQboNumber(r[2]);
      }
      if (end) {
        periodEnd = toIso(end[1]);
        endingBalance = parseQboNumber(r[2]);
      }
    }

    const headerIdx = rows.findIndex((r) => (r[0] ?? "").toLowerCase() === "date");
    const lines: BankStatementLine[] = [];
    for (let i = headerIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      const date = r[0] ?? "";
      if (!/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(date)) continue;
      const amount = parseQboNumber(r[2]);
      // Pula linhas sem valor OU zeradas (ex.: fee waivers que se anulam) — não entram na
      // reconciliação e não devem derrubar o match rate.
      if (amount == null || Number(amount) === 0) continue;
      lines.push({
        date: toIso(date),
        description: r[1] ?? "",
        amount,
        balance: parseQboNumber(r[3]),
      });
    }

    return { beginningBalance, endingBalance, periodStart, periodEnd, lines };
  },
};

export const BANK_ADAPTERS: BankAdapter[] = [bankOfAmerica];

export function getAdapter(id: string): BankAdapter | undefined {
  return BANK_ADAPTERS.find((a) => a.id === id);
}
