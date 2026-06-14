import { readFileSync } from "node:fs";
import { parseGeneralLedger } from "../src/lib/qbo/general-ledger";

const file = process.argv[2];
if (!file) throw new Error("usage: analyze-gl <file>");

const gl = parseGeneralLedger(readFileSync(file, "utf8"));

console.log(`Company:   ${gl.companyName}`);
console.log(`Period:    ${gl.periodLabel}`);
console.log(`Currency:  ${gl.currency}`);
console.log(`Txns:      ${gl.transactions.length}`);
console.log(`Accounts:  ${gl.accounts.length}`);

const vendors = new Set(gl.transactions.map((t) => t.name).filter(Boolean));
console.log(`Vendors:   ${vendors.size}`);

const byType: Record<string, number> = {};
for (const t of gl.transactions) byType[t.type] = (byType[t.type] ?? 0) + 1;
console.log("By type:", byType);

const dates = gl.transactions.map((t) => t.date).sort();
console.log(`Date range: ${dates[0]} → ${dates[dates.length - 1]}`);

const nonZero = gl.transactions.filter((t) => t.amount && Number(t.amount) !== 0).length;
console.log(`Non-zero amounts: ${nonZero}`);
console.log(`Sample accounts: ${gl.accounts.slice(0, 6).join(" | ")}`);
