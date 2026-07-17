import { readFileSync } from "fs";
import { classifyLoanDocPdf } from "../src/lib/pools/loan-doc-analyze";
const key = readFileSync(".env", "utf8").match(/^ANTHROPIC_API_KEY="?([^"\n]+)"?/m)?.[1];
if (key) process.env.ANTHROPIC_API_KEY = key;
const dir = "C:/Users/stefa/AppData/Local/Temp/claude/C--Users-stefa-OneDrive-Documents-Stefan-s/41f66944-52df-47ca-b76a-c8ce391c59e0/scratchpad";
for (const f of ["1601 West Country Club Boulevard _2_.pdf", "fci-servicing.pdf"]) {
  const b64 = readFileSync(`${dir}/${f}`).toString("base64");
  const r = await classifyLoanDocPdf(b64);
  console.log(f, "→", JSON.stringify(r));
}
