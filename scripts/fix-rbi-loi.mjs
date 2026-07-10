// Data-fix: "RDI" era na verdade RBI Private Lending — renomeia e aplica os termos do LOI
// #16804 (02/07/2026, 1601 W Country Club Blvd): 9% fixa non-Dutch, LTC 90 / LARV 70,
// orig 1,75% + broker 1%, fees fixos, draw fee $295, reserve exigida como LIQUIDEZ (não
// financiada), closing costs em caixa, term 12. Condicionado: só aplica termos se o perfil
// ainda está no esqueleto (aprPct = 12 default). No-op depois.
// Se "RDI" E "RBI Private Lending" coexistem (seed antigo ressuscitou o esqueleto), o RDI
// esqueleto sem uso é removido em vez de renomeado (rename causava P2002 no nome único).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LOI_TERMS = {
  rateType: "FIXED",
  aprPct: 9,
  interestBasis: "DRAWN", // non-Dutch (explícito no LOI)
  termMonths: 12,
  ltcBuildPct: 90,
  ltvPct: 70,
  haircutPct: 0,
  originationPct: 1.75,
  brokerPct: 1.0,
  processingFee: 495,
  appraisalFee: 600,
  legalFee: 500,
  budgetReviewFee: 475, // feasibility report
  inspectionFeePerDraw: 295,
  hasInterestReserve: false, // reserve exigida como LIQUIDEZ do borrower
  reserveMonths: 6,
  feesFinanced: false, // closing costs em caixa (DP + CC + 6m juros = liquidez)
  closingFeePct: 0,
  notes:
    "LOI #16804 (02/07/2026, 1601 W Country Club Blvd, Citrus Springs). Reserve como liquidez; prepayment none; LOI expira em 5 dias úteis.",
};

async function ensureFees(bankProfileId) {
  const fees = [
    { name: "Underwriting Fee", amount: 1500 },
    { name: "Other Fees", amount: 900 },
  ];
  const existing = await prisma.bankCustomFee.findMany({ where: { bankProfileId } });
  for (const f of fees) {
    if (existing.some((e) => e.name.toLowerCase() === f.name.toLowerCase())) continue;
    await prisma.bankCustomFee.create({
      data: { bankProfileId, name: f.name, timing: "CLOSING", kind: "FLAT", amount: f.amount },
    });
  }
}

async function main() {
  const rbi = await prisma.bankProfile.findUnique({ where: { name: "RBI Private Lending" } });
  const rdi = await prisma.bankProfile.findUnique({ where: { name: "RDI" } });

  if (rbi && rdi) {
    // esqueleto ressuscitado pelo seed antigo — remove se não estiver em uso
    const inUse = await prisma.poolSimulation.count({ where: { bankProfileId: rdi.id } });
    const isSkeleton = Number(rdi.aprPct) === 12;
    if (!inUse && isSkeleton) {
      await prisma.bankProfile.delete({ where: { id: rdi.id } });
      console.log("RDI esqueleto duplicado removido (RBI já existe)");
    } else {
      console.log("RDI e RBI coexistem mas RDI está em uso/editado — verificar manualmente");
    }
  } else if (rdi && !rbi) {
    const isSkeleton = Number(rdi.aprPct) === 12;
    await prisma.bankProfile.update({
      where: { id: rdi.id },
      data: { name: "RBI Private Lending", ...(isSkeleton ? LOI_TERMS : {}) },
    });
    if (isSkeleton) await ensureFees(rdi.id);
    console.log(`RDI → RBI Private Lending${isSkeleton ? " + termos do LOI" : ""}`);
    return;
  }

  // garante os termos no RBI se ele ainda estiver no esqueleto (criado pelo seed novo)
  const target = rbi ?? (await prisma.bankProfile.findUnique({ where: { name: "RBI Private Lending" } }));
  if (!target) return console.log("perfil RBI não encontrado");
  if (Number(target.aprPct) === 12) {
    await prisma.bankProfile.update({ where: { id: target.id }, data: LOI_TERMS });
    await ensureFees(target.id);
    console.log("RBI Private Lending: termos do LOI aplicados");
  } else {
    console.log("RBI Private Lending: já preenchido — nada a fazer");
  }
}

main().finally(() => prisma.$disconnect());
