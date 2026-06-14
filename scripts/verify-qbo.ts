import { readFileSync } from "node:fs";
import path from "node:path";
import { parseQboReport } from "../src/lib/qbo/parse";
import { parseQboNumber } from "../src/lib/qbo/numbers";

let failures = 0;
function check(label: string, got: unknown, expected: unknown) {
  const ok = String(got) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} | ${label}: ${got} (expected ${expected})`);
}

const fx = (f: string) => readFileSync(path.join(__dirname, "fixtures", f), "utf8");

// ── parseQboNumber ──
check("num: thousands", parseQboNumber('"6,907.00"'.replace(/"/g, "")), "6907.00");
check("num: $ + commas", parseQboNumber("$1,694,877.25"), "1694877.25");
check("num: negative $", parseQboNumber("-$8,000.00"), "-8000.00");
check("num: parentheses", parseQboNumber("(1,234.00)"), "-1234.00");
check("num: zero", parseQboNumber("$0.00"), "0");
check("num: empty", parseQboNumber(""), "null");
check("num: BRL R$", parseQboNumber("R$278,999.81"), "278999.81");
check("num: EUR €", parseQboNumber("€102.88"), "102.88");
check("num: neg BRL", parseQboNumber("-R$35,943.13"), "-35943.13");
check("num: EUR w/ spaces", parseQboNumber("  €5,813.96"), "5813.96");

// ── Relatório em português (Portugal) ──
const ptCsv = [
  "Hipérbole Vigilante Unipessoal Lda,",
  "Balanço patrimonial,",
  '"À data de 31 dez, 2025",',
  "",
  ",Total",
  "Ativos,",
  "Ativos circulantes,",
  'Caixa e equivalentes-caixa,"5,813.96"',
  'Total para Ativos circulantes,"  €5,813.96"',
  'Total para Ativos,"  €5,813.96"',
].join("\n");
const pt = parseQboReport(ptCsv);
check("PT type", pt.reportType, "BALANCE_SHEET");
check("PT currency", pt.currency, "EUR");
check(
  "PT 'Total para' parsed",
  pt.lines.find((l) => l.label === "Total para Ativos circulantes")?.values[0],
  "5813.96",
);
check(
  "PT leaf under section",
  pt.lines
    .find((l) => l.label === "Caixa e equivalentes-caixa")
    ?.sectionPath.includes("Ativos circulantes"),
  "true",
);

// ── L&L Balance Sheet ──
const ll = parseQboReport(fx("ll-balance-sheet.csv"));
check("LL company", ll.companyName, "L&L International Investment LLC");
check("LL type", ll.reportType, "BALANCE_SHEET");
check("LL period", ll.periodLabel, "As of Jun 14, 2026");
check("LL columns", ll.columns.join(","), "Total");
check("LL basis starts", (ll.basis ?? "").startsWith("Accrual Basis"), "true");

const find = (label: string) => ll.lines.find((l) => l.label === label);
const totalOf = (section: string) =>
  ll.lines.find((l) => l.lineType === "TOTAL" && l.label === `Total for ${section}`)?.values[0];

// Fechamento do balanço: Assets == Liabilities + Equity
const assets = Number(totalOf("Assets"));
const liab = Number(totalOf("Liabilities"));
const equity = Number(totalOf("Equity"));
check("LL Total Assets", totalOf("Assets"), "1694877.25");
check("LL balance closes (A = L + E)", (assets === liab + equity).toString(), "true");

// Conta sob 'Loans to Others' com valor e caminho corretos
const vixusLoan = find("Vixus Partners Investment LLC");
check("LL loan value", vixusLoan?.values[0], "767704.14");
check(
  "LL loan under 'Loans to Others'",
  vixusLoan?.sectionPath.includes("Loans to Others"),
  "true",
);

// Código de conta extraído do sufixo "(3303)"
const bank = find("Business Fundamentals Chk - 3303");
check("LL account code", bank?.accountCode, "3303");

// Negativo
check("LL negative", find("Corp Account - 3763")?.values[0], "-12955.87");

// Conta-pai com valor próprio + sub-contas (BofA - CC - 3763)
const corp = find("Corp Account - 3763");
check("LL nested under parent account", corp?.sectionPath.includes("BofA - CC - 3763"), "true");

// Vírgula dentro de aspas no nome
check("LL comma-in-name leaf exists", !!find("Truss Direct, LLC"), "true");

// ── J Monteiro Profit and Loss ──
const jm = parseQboReport(fx("jm-profit-and-loss.csv"));
check("JM company", jm.companyName, "J Monteiro Investment LLC");
check("JM type", jm.reportType, "PROFIT_AND_LOSS");
check("JM Net Income", jm.lines.find((l) => l.label === "Net Income")?.values[0], "120850.00");

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
