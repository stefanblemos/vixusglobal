// Smoke do #69 (conta de recebimento + trava). Read/write isolado numa entidade real do
// prodcopy, limpa no fim. Rodar: DATABASE_URL=<prodcopy> npx tsx scripts/smoke-payout.ts
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  maskAccount,
  payoutKeyHash,
  payoutStatus,
  validatePayout,
  payoutConfirmHash,
} from "../src/lib/pools/payout";
import { payoutByMember, payoutForEntityKey } from "../src/lib/pools/payout-data";

const prisma = new PrismaClient();
let pass = 0,
  fail = 0;
const ok = (c: boolean, m: string) => (c ? (pass++, console.log("  ✓", m)) : (fail++, console.log("  ✗", m)));

async function main() {
  console.log("1) puros");
  ok(maskAccount("123456789") === "••6789", "maskAccount últimos 4");
  ok(maskAccount("") === "—", "maskAccount vazio");
  const badNoBank = validatePayout({ beneficiaryName: "X", accountNumber: "123" });
  ok(!badNoBank.ok, "validate exige banco");
  const badRouting = validatePayout({ beneficiaryName: "X", bankName: "B", routingNumber: "123", accountNumber: "1" });
  ok(!badRouting.ok, "validate exige ABA de 9 dígitos");
  const good = validatePayout({ beneficiaryName: " X ", bankName: "BofA", routingNumber: "026-009-593", accountNumber: "00 1234" });
  ok(good.ok && good.normalized.routingNumber === "026009593" && good.normalized.accountNumber === "001234", "validate normaliza dígitos");
  const k1 = payoutKeyHash({ beneficiaryName: "X", bankName: "b", routingNumber: "1", accountNumber: "2", swift: null, iban: null });
  const k2 = payoutKeyHash({ beneficiaryName: "X", bankName: "b", routingNumber: "1", accountNumber: "9", swift: null, iban: null });
  ok(k1 !== k2, "keyHash muda com a conta");
  ok(payoutStatus(null) === "NONE", "status NONE sem conta");
  ok(payoutStatus({ status: "CONFIRMED", keyHash: null }) === "PENDING", "CONFIRMED sem keyHash cai p/ PENDING");

  console.log("2) alvo: um sócio real");
  const member = await prisma.poolMember.findFirst({
    where: { company: { legalName: { contains: "Bonomo" } } },
    include: { company: true },
  });
  if (!member?.companyId) throw new Error("Bonomo não encontrado no prodcopy");
  const entityKey = `c_${member.companyId}`;
  console.log("   ", member.company?.legalName, entityKey);

  // limpa resíduo de rodada anterior
  await prisma.payoutAccount.deleteMany({ where: { companyId: member.companyId } });

  console.log("3) operador cadastra → PENDING");
  const v = validatePayout({ beneficiaryName: "Bonomo Investments LLC", bankName: "Bank of America", routingNumber: "026009593", accountNumber: "1234567", accountType: "checking" });
  if (!v.ok) throw new Error(v.error);
  const kh = payoutKeyHash(v.normalized);
  await prisma.payoutAccount.create({
    data: { companyId: member.companyId, ...v.normalized, keyHash: kh, status: "DRAFT", enteredByEmail: "op@vixus" },
  });
  let map = await payoutByMember([{ id: member.id, partyId: member.partyId, companyId: member.companyId }]);
  ok(map[member.id]?.status === "PENDING", "payoutByMember = PENDING após cadastro do operador");
  ok(map[member.id]?.mask === "••4567", "máscara no map");

  console.log("4) trava: pagamento negado enquanto PENDING");
  const accPending = await payoutForEntityKey(entityKey);
  ok(payoutStatus(accPending) !== "CONFIRMED", "gate bloqueia (não CONFIRMED)");

  console.log("5) sócio confirma no portal → CONFIRMED");
  const at = new Date("2026-07-23T12:00:00Z");
  const ch = payoutConfirmHash({ key: v.normalized, entityKey, byEmail: "socio@bonomo", at });
  await prisma.payoutAccount.update({
    where: { companyId: member.companyId },
    data: { status: "CONFIRMED", confirmedAt: at, confirmedByEmail: "socio@bonomo", confirmHash: ch, keyHash: kh },
  });
  const accConf = await payoutForEntityKey(entityKey);
  ok(payoutStatus(accConf) === "CONFIRMED", "gate LIBERA após confirmação");

  console.log("6) troca de instrução re-zera (BEC)");
  const v2 = validatePayout({ beneficiaryName: "Bonomo Investments LLC", bankName: "Chase", routingNumber: "021000021", accountNumber: "9999999" });
  if (!v2.ok) throw new Error(v2.error);
  const kh2 = payoutKeyHash(v2.normalized);
  const changed = accConf!.keyHash !== kh2;
  ok(changed, "keyHash detecta a troca → operador re-zera p/ DRAFT");

  console.log("limpando…");
  await prisma.payoutAccount.deleteMany({ where: { companyId: member.companyId } });

  console.log(`\n${fail === 0 ? "OK" : "FALHOU"} — ${pass} passaram, ${fail} falharam`);
  if (fail) process.exitCode = 1;
}
main().finally(() => prisma.$disconnect());
