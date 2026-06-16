import { readFileSync } from "node:fs";
for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && m[1] === "ANTHROPIC_API_KEY") process.env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}
process.env.DATABASE_URL =
  "postgresql://postgres.lggvktosowdbfvmnhvoh:CMnllJp7ZmBY5xNC@aws-1-us-east-1.pooler.supabase.com:5432/postgres";

import { PrismaClient } from "@prisma/client";
import { analyzeTaxReturnPdf } from "../src/lib/ir/analyze";
import { clampPdfPages } from "../src/lib/ir/pdf";

const prisma = new PrismaClient();

async function main() {
  // só os que ainda não têm k1sReceived e têm PDF
  const list = await prisma.taxReturn.findMany({
    where: { companyId: { not: null }, pdfSize: { not: null } },
    select: { id: true, matchedName: true, year: true, k1sReceived: true },
    orderBy: [{ matchedName: "asc" }, { year: "asc" }],
  });
  const todo = list.filter((t) => ((t.k1sReceived as unknown[]) ?? []).length === 0);
  console.log(`A re-analisar: ${todo.length} de ${list.length}`);

  let ok = 0;
  for (const t of todo) {
    const label = `${t.matchedName} ${t.year}`;
    try {
      const rec = await prisma.taxReturn.findUnique({ where: { id: t.id }, select: { pdf: true } });
      if (!rec?.pdf) {
        console.log(`  - ${label}: sem PDF, pulando`);
        continue;
      }
      const clamped = await clampPdfPages(Buffer.from(rec.pdf), 100);
      const data = await analyzeTaxReturnPdf(clamped.buf.toString("base64"));
      await prisma.taxReturn.update({
        where: { id: t.id },
        data: { k1sReceived: data.k1sReceived },
      });
      const sum = data.k1sReceived.reduce((s, k) => s + k.amount, 0);
      console.log(`  ✓ ${label}: ${data.k1sReceived.length} K-1 (soma ${sum})`);
      ok++;
    } catch (e) {
      console.log(`  ✗ ${label}: ERRO ${(e as Error).message}`);
    }
  }
  console.log(`\nConcluido: ${ok}/${todo.length} atualizados.`);
}
main().finally(() => prisma.$disconnect());
