// Exporta as PREMISSAS p/ o pacote standalone (a 4U já tem locations/modelos; isto não):
// cenários, fees por tipo, perfis de banco (com custom fees), waterfall default e custos
// de veículo → standalone/data/premissas.json. Rodar contra o espelho de produção:
//   DATABASE_URL="<prodcopy>" npx tsx scripts/export-premissas.ts
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";

async function main() {
  const scenarios = (await prisma.bufferScenario.findMany({ orderBy: { sortOrder: "asc" } })).map((s) => ({
    code: s.code,
    name: s.name,
    unitGapDays: s.unitGapDays,
    salePriceBufferPct: Number(s.salePriceBufferPct),
    constructionCostBufferPct: Number(s.constructionCostBufferPct),
    lotCostBufferPct: Number(s.lotCostBufferPct),
    closingFeePct: Number(s.closingFeePct),
    contingencyReservePct: Number(s.contingencyReservePct),
    landAcquisitionDays: s.landAcquisitionDays,
    saleClosingDays: s.saleClosingDays,
    constructionDurationBufferM: Number(s.constructionDurationBufferM),
    salesAbsorptionMonths: s.salesAbsorptionMonths == null ? null : Number(s.salesAbsorptionMonths),
    emdPct: Number(s.emdPct),
  }));

  const houseTypeFees = Object.fromEntries(
    (await prisma.houseTypeFee.findMany()).map((f) => [f.type as string, Number(f.fee)]),
  );

  const banks = (
    await prisma.bankProfile.findMany({ include: { customFees: true }, orderBy: { name: "asc" } })
  ).map((b) => ({
    name: b.name,
    ltcBuildPct: Number(b.ltcBuildPct),
    ltcLandPct: Number(b.ltcLandPct),
    financeLand: b.financeLand,
    ltvPct: Number(b.ltvPct),
    haircutPct: Number(b.haircutPct),
    perUnitCap: b.perUnitCap == null ? null : Number(b.perUnitCap),
    closingPermitPct: Number(b.closingPermitPct),
    rateType: b.rateType,
    aprPct: Number(b.aprPct),
    indexPct: Number(b.indexPct),
    spreadPct: Number(b.spreadPct),
    interestBasis: b.interestBasis,
    originationPct: Number(b.originationPct),
    originationFlat: Number(b.originationFlat),
    brokerPct: Number(b.brokerPct),
    titleEscrowPct: Number(b.titleEscrowPct),
    closingFeePct: Number(b.closingFeePct),
    processingFee: Number(b.processingFee),
    budgetReviewFee: Number(b.budgetReviewFee),
    appraisalFee: Number(b.appraisalFee),
    legalFee: Number(b.legalFee),
    feesFinanced: b.feesFinanced,
    servicingMonthly: Number(b.servicingMonthly),
    inspectionFeePerDraw: Number(b.inspectionFeePerDraw),
    drawProcessingFee: Number(b.drawProcessingFee),
    achFeePerBatch: Number(b.achFeePerBatch),
    hasInterestReserve: b.hasInterestReserve,
    reserveMonths: Number(b.reserveMonths),
    reserveInEnvelope: b.reserveInEnvelope,
    overfundingMode: b.overfundingMode,
    releaseMode: b.releaseMode,
    sweepPct: Number(b.sweepPct),
    reconveyanceFee: Number(b.reconveyanceFee),
    termMonths: b.termMonths,
    extensionFeePct: Number(b.extensionFeePct),
    customFees: b.customFees.map((f) => ({ name: f.name, timing: f.timing, kind: f.kind, amount: Number(f.amount) })),
  }));

  const waterfallTiers = (
    await prisma.catalogWaterfallTier.findMany({ orderBy: { sortOrder: "asc" } })
  ).map((t) => ({ hurdlePct: t.hurdlePct == null ? null : Number(t.hurdlePct), promotePct: Number(t.promotePct) }));

  const vehicleCosts = (
    await prisma.catalogVehicleCost.findMany({ orderBy: { sortOrder: "asc" } })
  ).map((c) => ({ id: c.id, name: c.name, amount: Number(c.amount), timing: c.timing }));

  const out = {
    exportedAt: new Date().toISOString().slice(0, 10),
    source: "Vixus production",
    scenarios,
    houseTypeFees,
    banks,
    waterfallTiers,
    vehicleCosts,
  };
  const dest = path.join(import.meta.dirname, "..", "standalone", "data", "premissas.json");
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + "\n");
  console.log(
    `premissas.json: ${scenarios.length} cenários · ${Object.keys(houseTypeFees).length} fees · ${banks.length} bancos · ${waterfallTiers.length} tiers · ${vehicleCosts.length} custos de veículo`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
