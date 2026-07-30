// Smoke #draws — template de mensagem + roundtrip dos campos novos. Apagar depois.
// Rodar: DATABASE_URL=<prodcopy> npx tsx scripts/smoke-draw-message.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { DEFAULT_DRAW_TEMPLATE, fillDrawTemplate } from "../src/lib/pools/draw-message";

const prisma = new PrismaClient();
let pass = 0, fail = 0;
const ok = (c: boolean, m: string) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));

async function main() {
  console.log("1) template puro");
  const tokens = {
    bank: "FCI Lender Services", pool: "PH-4", address: "13387 SW 69th Pl, Rolling Hills FL",
    pin: "https://maps.google.com/?q=1,2", lockbox: "4729", drawNumber: "3", amount: "$54,900.00", loanNumber: "399671",
  };
  const msg = fillDrawTemplate(null, tokens);
  ok(msg.includes("13387 SW 69th Pl"), "endereço no texto");
  ok(msg.includes("4729") && msg.includes("399671"), "lockbox + loan no texto");
  ok(msg.includes("$54,900.00") && msg.includes("Draw #3"), "valor + nº do draw");
  ok(!/\{\w+\}/.test(msg), "nenhum token sobrou no default");
  const custom = fillDrawTemplate("Oi {bank}, draw {drawNumber} de {amount}. Lockbox {lockbox}.", tokens);
  ok(custom === "Oi FCI Lender Services, draw 3 de $54,900.00. Lockbox 4729.", "template custom respeitado");

  console.log("2) roundtrip dos campos novos (prodcopy, isolado)");
  const house = await prisma.poolHouse.findFirst({ where: { address: { contains: "13387 SW 69th" } }, select: { id: true, pinLocation: true, lockboxCode: true } });
  if (!house) throw new Error("casa 13387 não encontrada");
  await prisma.poolHouse.update({ where: { id: house.id }, data: { pinLocation: "SMOKE_PIN", lockboxCode: "SMOKE_LB" } });
  const h2 = await prisma.poolHouse.findUnique({ where: { id: house.id }, select: { pinLocation: true, lockboxCode: true } });
  ok(h2?.pinLocation === "SMOKE_PIN" && h2?.lockboxCode === "SMOKE_LB", "pin/lockbox gravam e leem na casa");
  await prisma.poolHouse.update({ where: { id: house.id }, data: { pinLocation: house.pinLocation, lockboxCode: house.lockboxCode } }); // restaura

  const draw = await prisma.poolLoanEntry.findFirst({ where: { type: "DRAW", pending: true }, select: { id: true, bankNotifiedAt: true } });
  if (draw) {
    await prisma.poolLoanEntry.update({ where: { id: draw.id }, data: { bankNotifiedAt: new Date("2026-07-21") } });
    const d2 = await prisma.poolLoanEntry.findUnique({ where: { id: draw.id }, select: { bankNotifiedAt: true } });
    ok(d2?.bankNotifiedAt?.toISOString().slice(0, 10) === "2026-07-21", "bankNotifiedAt grava/lê no draw");
    await prisma.poolLoanEntry.update({ where: { id: draw.id }, data: { bankNotifiedAt: draw.bankNotifiedAt } }); // restaura
  } else console.log("   (sem draw pendente p/ testar bankNotifiedAt — ok)");

  const bank = await prisma.bankProfile.findFirst({ select: { id: true, drawRequestTemplate: true } });
  if (bank) {
    await prisma.bankProfile.update({ where: { id: bank.id }, data: { drawRequestTemplate: "SMOKE_TPL {bank}" } });
    const b2 = await prisma.bankProfile.findUnique({ where: { id: bank.id }, select: { drawRequestTemplate: true } });
    ok(b2?.drawRequestTemplate === "SMOKE_TPL {bank}", "template grava/lê no banco");
    await prisma.bankProfile.update({ where: { id: bank.id }, data: { drawRequestTemplate: bank.drawRequestTemplate } }); // restaura
  }

  console.log(`\n${fail === 0 ? "OK" : "FALHOU"} — ${pass} passaram, ${fail} falharam`);
  if (fail) process.exitCode = 1;
}
main().finally(() => prisma.$disconnect());
