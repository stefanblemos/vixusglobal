import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { importGeneralLedger } from "../src/lib/qbo/gl-import";

const prisma = new PrismaClient();
const DIR = process.argv[2] ?? "C:\\Users\\stefa\\Downloads";

async function main() {
  const files = readdirSync(DIR).filter((f) => /general ledger\.csv$/i.test(f));
  if (files.length === 0) {
    console.log("Nenhum arquivo '*_General Ledger.csv' encontrado em", DIR);
    return;
  }
  for (const file of files) {
    const text = readFileSync(path.join(DIR, file), "utf8");
    const r = await importGeneralLedger(prisma, text, file);
    const tag = r.matched ? "✓" : "UNMATCHED";
    console.log(`[${tag}] ${r.companyName} — ${r.transactions} txns, ${r.vendors} vendors`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
