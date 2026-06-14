import { readFileSync } from "node:fs";
import { parseGeneralLedger } from "../src/lib/qbo/general-ledger";

const FILE = "C:\\Users\\stefa\\Downloads\\14528 Braddock Oak Dr LLC_General Ledger.csv";

let failures = 0;
function check(label: string, got: unknown, expected: unknown) {
  const ok = String(got) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} | ${label}: ${got} (expected ${expected})`);
}

const gl = parseGeneralLedger(readFileSync(FILE, "utf8"));

check("company", gl.companyName, "14528 Braddock Oak Dr LLC");
check("currency", gl.currency, "USD");
check("transactions", gl.transactions.length, 1056);

const byType = (t: string) => gl.transactions.filter((x) => x.type === t).length;
check("Expense count", byType("Expense"), 808);
check("Check count", byType("Check"), 124);
check("Journal Entry count", byType("Journal Entry"), 69);
check("Deposit count", byType("Deposit"), 55);

// As contas de empréstimo existem
check(
  "has 'Loan - L&L...' account",
  gl.accounts.includes("Loan - L&L International Investments LLC"),
  true,
);
check(
  "has 'Loan - Fabiola Lemos, PA' account",
  gl.accounts.includes("Loan - Fabiola Lemos, PA"),
  true,
);

// A transação datada do empréstimo da L&L (06/13/2024, $5.000)
const llLoan = gl.transactions.find(
  (t) => t.name === "L&L International Investments LLC" && t.type === "Deposit",
);
check("L&L loan deposit date", llLoan?.date, "2024-06-13");
check("L&L loan deposit amount", llLoan?.amount, "5000.00");

// Vendors distintos (coluna Name)
const vendors = new Set(gl.transactions.map((t) => t.name).filter(Boolean));
console.log(`\nDistinct names (vendors/counterparties): ${vendors.size}`);
console.log(`Sample: ${[...vendors].slice(0, 8).join(" | ")}`);

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
