import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { drawNumberForBatch, nextDrawNumber } from "../src/lib/pools/draws";
const p = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
(async () => {
  let pass = 0, fail = 0;
  const ok = (c: boolean, m: string) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));
  const fci = await p.poolLoan.findFirst({ where: { bankProfile: { name: { contains: "FCI" } } }, select: { id: true } });
  ok((await drawNumberForBatch(fci!.id, new Date("2026-07-29"))) === 1, "mesma data (07/29) reusa #1 (leva)");
  const next = await drawNumberForBatch(fci!.id, new Date("2026-08-15"));
  ok(next === (await nextDrawNumber(fci!.id)) && next === 2, "data nova -> proximo numero (#" + next + ")");
  const rbi = await p.poolLoan.findFirst({ where: { bankProfile: { name: { contains: "RBI" } } }, select: { id: true } });
  ok((await drawNumberForBatch(rbi!.id, new Date("2026-07-29"))) === 1, "per-loan: RBI 07/29 tem sequencia propria (#1)");
  console.log(`\n${fail === 0 ? "OK" : "FALHOU"} - ${pass} passaram, ${fail} falharam`);
  await p.$disconnect();
})();
