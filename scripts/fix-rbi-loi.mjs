// Data-fix: "RDI" era na verdade RBI Private Lending — renomeia e aplica os termos do LOI
// #16804 (02/07/2026, 1601 W Country Club Blvd): 9% fixa non-Dutch, LTC 90 / LARV 70,
// orig 1,75% + broker 1%, fees fixos, draw fee $295, reserve exigida como LIQUIDEZ (não
// financiada), closing costs em caixa, term 12. Condicionado: só aplica se o perfil ainda
// está no esqueleto (aprPct = 12 default). No-op depois.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const rdi = await prisma.bankProfile.findFirst({
    where: { name: { in: ["RDI", "RBI Private Lending"] } },
  });
  if (!rdi) return console.log("perfil RDI/RBI não encontrado");
  const isSkeleton = Number(rdi.aprPct) === 12; // ainda com defaults
  await prisma.bankProfile.update({
    where: { id: rdi.id },
    data: {
      name: "RBI Private Lending",
      ...(isSkeleton
        ? {
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
          }
        : {}),
    },
  });
  if (isSkeleton) {
    const fees = [
      { name: "Underwriting Fee", amount: 1500 },
      { name: "Other Fees", amount: 900 },
    ];
    const existing = await prisma.bankCustomFee.findMany({ where: { bankProfileId: rdi.id } });
    for (const f of fees) {
      if (existing.some((e) => e.name.toLowerCase() === f.name.toLowerCase())) continue;
      await prisma.bankCustomFee.create({
        data: { bankProfileId: rdi.id, name: f.name, timing: "CLOSING", kind: "FLAT", amount: f.amount },
      });
    }
  }
  console.log(`RBI Private Lending: ${isSkeleton ? "termos do LOI aplicados" : "já preenchido — só nome conferido"}`);
}

main().finally(() => prisma.$disconnect());
