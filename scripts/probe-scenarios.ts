import { prisma } from "../src/lib/db";

async function main() {
  const scs = await prisma.bufferScenario.findMany({ orderBy: { sortOrder: "asc" } });
  for (const s of scs)
    console.log(
      JSON.stringify({
        code: s.code,
        name: s.name,
        venda: Number(s.salePriceBufferPct),
        obra: Number(s.constructionCostBufferPct),
        lote: Number(s.lotCostBufferPct),
        closingFee: Number(s.closingFeePct),
        conting: Number(s.contingencyReservePct),
        escrowLote: s.landAcquisitionDays,
        closingVenda: s.saleClosingDays,
        prazoObra: Number(s.constructionDurationBufferM),
        absorcao: s.salesAbsorptionMonths == null ? null : Number(s.salesAbsorptionMonths),
        emd: Number(s.emdPct),
        gap: s.unitGapDays,
        slippage: Number(s.stressSlippagePct),
      }),
    );
}

main().finally(() => prisma.$disconnect());
