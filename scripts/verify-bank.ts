import { readFileSync } from "node:fs";
import { getAdapter } from "../src/lib/bank/adapters";

const FILE = "C:\\Users\\stefa\\Downloads\\stmt.csv";
let failures = 0;
const check = (label: string, got: unknown, expected: unknown) => {
  const ok = String(got) === String(expected);
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} | ${label}: ${got} (expected ${expected})`);
};

const boa = getAdapter("boa")!;
const st = boa.parse(readFileSync(FILE, "utf8"));

check("beginning balance", st.beginningBalance, "6124.52");
check("ending balance", st.endingBalance, "5732.89");
check("period start", st.periodStart, "2026-01-01");
check("period end", st.periodEnd, "2026-06-12");
check("lines", st.lines.length, 80);
check("first line date", st.lines[0]?.date, "2026-01-02");
check("first line amount", st.lines[0]?.amount, "-110.00");
check(
  "a transfer credit",
  st.lines.find((l) => l.description.includes("transfer from"))?.amount,
  "2000.00",
);

console.log(failures === 0 ? "\nALL TESTS PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
