import { prisma } from "@/lib/db";
import type { SimInput, SimUnitInput } from "@/lib/pools/simulator";

export type UnitRef = { locationId: string; modelId: string };

export type PromoteTierInput = { hurdlePct: number | null; promotePct: number };

// Monta o SimInput a partir dos catálogos atuais (valores sempre frescos do banco).
// Módulo neutro: usado pelas server actions E pelos server components (cards de cenário).
export async function buildSimInput(sim: {
  fundingMode: string;
  upfrontFunding?: boolean;
  compMode: string;
  perfPct: unknown;
  perfTiming: string;
  promoteTiers: PromoteTierInput[] | null;
  flatFeePerHouse: unknown;
  paymentPlan: string;
  equityGatePct: unknown;
  parallelPermit: boolean;
  unitGapDays: number;
  scenarioCode: string;
  bankProfileId: string | null;
  units: UnitRef[];
}): Promise<SimInput | { error: string }> {
  const scenario = await prisma.bufferScenario.findUnique({ where: { code: sim.scenarioCode } });
  if (!scenario) return { error: "Scenario not found." };
  const bank = sim.bankProfileId
    ? await prisma.bankProfile.findUnique({
        where: { id: sim.bankProfileId },
        include: { customFees: true },
      })
    : null;
  if (sim.fundingMode === "BANK" && !bank) return { error: "Pick a bank profile for bank funding." };

  const fees = new Map(
    (await prisma.houseTypeFee.findMany()).map((f) => [f.type as string, Number(f.fee)]),
  );
  const units: SimUnitInput[] = [];
  for (const ref of sim.units) {
    const ml = await prisma.catalogModelLocation.findUnique({
      where: { modelId_locationId: { modelId: ref.modelId, locationId: ref.locationId } },
      include: { model: true, location: true },
    });
    if (!ml) return { error: "A selected model is not available in the selected location." };
    const lotCost = ml.location.lotCostEstimate;
    if (lotCost == null)
      return { error: `Set the estimated lot cost for ${ml.location.name} in the catalog.` };
    if (sim.compMode === "CONTRACTOR_FEE" && ml.costContractor == null)
      return { error: `Set the contractor cost for ${ml.model.name} at ${ml.location.name} in the catalog.` };
    if (sim.compMode === "OPEN_BOOK" && ml.costOpenBook == null)
      return { error: `Set the open book cost for ${ml.model.name} at ${ml.location.name} in the catalog.` };
    if (
      (sim.compMode === "PERFORMANCE" || sim.compMode === "PROMOTE") &&
      ml.costPerformance == null
    )
      return { error: `Set the performance cost for ${ml.model.name} at ${ml.location.name} in the catalog.` };
    units.push({
      label: `${ml.model.name} — ${ml.location.name}`,
      locationName: ml.location.name,
      modelName: ml.model.name,
      permitDays: ml.location.permitDays,
      lotLeadDays: ml.location.lotLeadDays,
      saleDays: ml.location.saleDays,
      buildMonths: Number(ml.model.buildMonths),
      costPerformance: Number(ml.costPerformance ?? 0),
      costContractor: Number(ml.costContractor ?? 0),
      costOpenBook: Number(ml.costOpenBook ?? 0),
      contractorFee: Number(ml.model.contractorFee ?? fees.get(ml.model.houseType) ?? 0),
      lotCost: Number(lotCost),
      salePrice: Number(ml.salePrice),
    });
  }
  if (units.length === 0) return { error: "Add at least one house to simulate." };

  return {
    fundingMode: sim.fundingMode as "EQUITY" | "BANK",
    upfrontFunding: sim.upfrontFunding ?? false,
    compMode: sim.compMode as "CONTRACTOR_FEE" | "PERFORMANCE" | "PROMOTE" | "OPEN_BOOK",
    perfPct: Number(sim.perfPct) / 100,
    perfTiming: sim.perfTiming === "PER_SALE" ? "PER_SALE" : "PROJECT_COMPLETION",
    promoteTiers: sim.promoteTiers,
    flatFeePerHouse: Number(sim.flatFeePerHouse ?? 0),
    paymentPlan: sim.paymentPlan === "LIGHT_START" ? "LIGHT_START" : "STANDARD",
    equityGatePct: Number(sim.equityGatePct) / 100,
    parallelPermit: sim.parallelPermit,
    // gap entre início das casas vem do CENÁRIO (Ótimo 10 · Real 20 · Conservador 30)
    unitGapDays: scenario.unitGapDays,
    scenario: {
      salePriceBufferPct: Number(scenario.salePriceBufferPct),
      constructionCostBufferPct: Number(scenario.constructionCostBufferPct),
      lotCostBufferPct: Number(scenario.lotCostBufferPct),
      closingFeePct: Number(scenario.closingFeePct),
      contingencyReservePct: Number(scenario.contingencyReservePct),
      landAcquisitionDays: scenario.landAcquisitionDays,
      constructionDurationBufferM: Number(scenario.constructionDurationBufferM),
      salesAbsorptionMonths:
        scenario.salesAbsorptionMonths == null ? null : Number(scenario.salesAbsorptionMonths),
      emdPct: Number(scenario.emdPct),
    },
    bank: bank
      ? {
          ltcBuildPct: Number(bank.ltcBuildPct),
          ltcLandPct: Number(bank.ltcLandPct),
          financeLand: bank.financeLand,
          ltvPct: Number(bank.ltvPct),
          haircutPct: Number(bank.haircutPct),
          perUnitCap: bank.perUnitCap == null ? null : Number(bank.perUnitCap),
          closingPermitPct: Number(bank.closingPermitPct),
          effectiveAprPct:
            bank.rateType === "FIXED"
              ? Number(bank.aprPct)
              : Number(bank.indexPct) + Number(bank.spreadPct),
          interestBasis: bank.interestBasis,
          originationPct: Number(bank.originationPct),
          originationFlat: Number(bank.originationFlat),
          brokerPct: Number(bank.brokerPct),
          titleEscrowPct: Number(bank.titleEscrowPct),
          closingFeePct: Number(bank.closingFeePct),
          processingFee: Number(bank.processingFee),
          budgetReviewFee: Number(bank.budgetReviewFee),
          appraisalFee: Number(bank.appraisalFee),
          legalFee: Number(bank.legalFee),
          feesFinanced: bank.feesFinanced,
          servicingMonthly: Number(bank.servicingMonthly),
          inspectionFeePerDraw: Number(bank.inspectionFeePerDraw),
          drawProcessingFee: Number(bank.drawProcessingFee),
          achFeePerBatch: Number(bank.achFeePerBatch),
          hasInterestReserve: bank.hasInterestReserve,
          reserveMonths: Number(bank.reserveMonths),
          reserveInEnvelope: bank.reserveInEnvelope,
          overfundingMode: bank.overfundingMode,
          releaseMode: bank.releaseMode,
          sweepPct: Number(bank.sweepPct),
          reconveyanceFee: Number(bank.reconveyanceFee),
          termMonths: bank.termMonths,
          extensionFeePct: Number(bank.extensionFeePct),
          // extensão só entra no cenário Conservador (regra do Stefan — na prática, não)
          applyExtensionFee: sim.scenarioCode === "CONS",
          customFees: bank.customFees.map((f) => ({
            name: f.name,
            timing: f.timing,
            kind: f.kind,
            amount: Number(f.amount),
          })),
        }
      : null,
    units,
  };
}
