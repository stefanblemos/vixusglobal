// Data-fix (17/07/2026, OK do Stefan): os drawables das casas da FCI foram redistribuídos
// na tela somando a fatia dos ~$66k de fees (218.333/328.333/226.333/323.333/323.333/
// 226.333 — soma 1.645.998 ≈ teto). Convenção definida: drawable da casa = orçamento de
// OBRA aprovado, sempre — os fees são tratados pela MODALIDADE do envelope (por dentro),
// senão a suficiência dupla-conta. Volta aos valores de obra e marca a FCI como "por
// dentro". Guardado pelos valores exatos da redistribuição — no-op se o Stefan já mexeu.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const FIXES = [
  { startsWith: "2210 SW 21st Terrace", from: 218333, to: 195000 },
  { startsWith: "6529 SW 140th Place", from: 328333, to: 330000 },
  { startsWith: "21987 SW Mango", from: 226333, to: 200000 },
  { startsWith: "13819 SW 56th", from: 323333, to: 330000 },
  { startsWith: "13387 SW 69th", from: 323333, to: 330000 },
  { startsWith: "1939 SW Viburnum", from: 226333, to: 195000 },
];

async function main() {
  const pool = await prisma.investmentPool.findUnique({
    where: { code: "PH-4" },
    include: { houses: true, loans: { include: { bankProfile: true } } },
  });
  if (!pool) return console.log("PH-4 não encontrado — nada a fazer");

  let changed = 0;
  for (const f of FIXES) {
    const h = pool.houses.find((x) => x.address.startsWith(f.startsWith));
    if (!h || h.bankLoanAmount == null) continue;
    if (Math.abs(Number(h.bankLoanAmount) - f.from) > 1) continue; // já mexido — não pisa
    await prisma.poolHouse.update({ where: { id: h.id }, data: { bankLoanAmount: f.to } });
    console.log(`${f.startsWith}…: drawable ${f.from} ⇒ ${f.to} (obra pura)`);
    changed++;
  }

  // FCI é net funding (servicing: fees + crédito saíram do teto de 1.646.000)
  const fci = pool.loans.find((l) => (l.bankProfile?.name ?? "").includes("FCI"));
  if (fci && fci.feesInEnvelope == null) {
    await prisma.poolLoan.update({ where: { id: fci.id }, data: { feesInEnvelope: true } });
    console.log("FCI: modalidade marcada como POR DENTRO do envelope");
    changed++;
  }
  console.log(changed > 0 ? `fix-fci-drawables: ${changed} ajustes` : "fix-fci-drawables: nada a fazer");
}

main().finally(() => prisma.$disconnect());
