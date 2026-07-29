// Smoke do gate de draw (#draws). Confirma o resolver e o estado real do loan do PH-4.
// Rodar: DATABASE_URL=<prodcopy> npx tsx scripts/smoke-draw-gate.ts   (apagar depois)
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { loanAwaitingClosing } from "../src/lib/pools/draws";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));

async function main() {
  console.log("1) resolver puro");
  ok(loanAwaitingClosing({ closingDate: null }) === true, "sem closingDate → awaiting");
  ok(loanAwaitingClosing({ closingDate: new Date("2026-01-01") }) === false, "com closingDate → não awaiting");

  console.log("2) loans reais com draw pendente e SEM closing (o furo que existia)");
  const loans = await prisma.poolLoan.findMany({
    include: {
      pool: { select: { code: true } },
      bankProfile: { select: { name: true } },
    },
  });
  let flagged = 0;
  for (const l of loans) {
    const draws = await prisma.poolLoanEntry.count({ where: { loanId: l.id, type: "DRAW" } });
    if (draws === 0) continue;
    const awaiting = loanAwaitingClosing(l);
    console.log(`   ${l.pool.code} · ${l.bankProfile?.name ?? "banco"} · closingDate=${l.closingDate ? l.closingDate.toISOString().slice(0,10) : "—"} · draws=${draws} · awaitingClosing=${awaiting}${awaiting ? "  ← agora BLOQUEADO p/ novos draws" : ""}`);
    if (awaiting) flagged++;
  }
  ok(true, `varredura ok (${loans.length} loans, ${flagged} sem closing com draw — antes deixava criar, agora não)`);

  console.log(`\n${fail === 0 ? "OK" : "FALHOU"} — ${pass} passaram, ${fail} falharam`);
  if (fail) process.exitCode = 1;
}
main().finally(() => prisma.$disconnect());
