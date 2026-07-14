import { prisma } from "@/lib/db";
import type { SimInput, SimUnitInput } from "@/lib/pools/simulator";

export type UnitRef = { locationId: string; modelId: string; cycle?: number };

export type PromoteTierInput = { hurdlePct: number | null; promotePct: number };

// Aba Premissas: ajuste fino por simulação — só guarda o que DIVERGE do catálogo.
// Override substitui o valor do catálogo em TODA a conta (inclusive o sizing do banco);
// os buffers do cenário aplicam POR CIMA do valor ajustado.
export type LocationOverride = {
  lotCost?: number;
  lotLeadDays?: number;
  permitDays?: number;
  saleDays?: number;
};
export type ComboOverride = {
  salePrice?: number;
  costPerformance?: number;
  costContractor?: number;
  costOpenBook?: number;
  contractorFee?: number;
  buildMonths?: number;
};
// Grade "Cenário — os três lado a lado": overrides POR CENÁRIO (chave = code do cenário).
// Só os campos que o motor realmente usa (stressSlippagePct fica fora — não entra na conta).
export type ScenarioOverride = {
  salePriceBufferPct?: number;
  constructionCostBufferPct?: number;
  lotCostBufferPct?: number;
  closingFeePct?: number;
  contingencyReservePct?: number;
  landAcquisitionDays?: number;
  saleClosingDays?: number;
  constructionDurationBufferM?: number;
  salesAbsorptionMonths?: number;
  emdPct?: number;
  unitGapDays?: number;
};
export type SimOverrides = {
  locations?: Record<string, LocationOverride>;
  combos?: Record<string, ComboOverride>; // chave "modelId|locationId"
  scenarios?: Record<string, ScenarioOverride>; // chave = code (OPT/REAL/CONS/custom)
  vehicleCosts?: Record<string, number>; // chave = id do CatalogVehicleCost → valor ajustado
};

export const comboKey = (modelId: string, locationId: string) => `${modelId}|${locationId}`;

export function countOverrides(o: SimOverrides | null | undefined): number {
  if (!o) return 0;
  let n = 0;
  for (const v of Object.values(o.locations ?? {})) n += Object.keys(v).length;
  for (const v of Object.values(o.combos ?? {})) n += Object.keys(v).length;
  for (const v of Object.values(o.scenarios ?? {})) n += Object.keys(v).length;
  n += Object.keys(o.vehicleCosts ?? {}).length;
  return n;
}

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
  unitGapDays: number;
  scenarioCode: string;
  bankProfileId: string | null;
  units: UnitRef[];
  overrides?: SimOverrides | null;
  vehicleStructure?: string; // VIXUS_MANAGED (default) carrega os custos do veículo
}): Promise<SimInput | { error: string }> {
  const scenario = await prisma.bufferScenario.findUnique({ where: { code: sim.scenarioCode } });
  if (!scenario) return { error: "Scenario not found." };
  // overrides da grade de cenário (aba Premissas) para ESTE cenário
  const so = sim.overrides?.scenarios?.[sim.scenarioCode] ?? {};
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
  // Esteira de ciclos é só para EQUITY — no banco, um ciclo por LLC/loan (regra do Stefan)
  const hasCycles = sim.units.some((u) => (u.cycle ?? 1) > 1);
  if (sim.fundingMode === "BANK" && hasCycles)
    return { error: "Ciclos são só para equity — com banco, use um ciclo (uma LLC/loan por ciclo)." };
  const units: SimUnitInput[] = [];
  for (const ref of sim.units) {
    const ml = await prisma.catalogModelLocation.findUnique({
      where: { modelId_locationId: { modelId: ref.modelId, locationId: ref.locationId } },
      include: { model: true, location: true },
    });
    if (!ml) return { error: "A selected model is not available in the selected location." };
    // Premissas da simulação (aba Premissas): override ?? catálogo, campo a campo
    const lo = sim.overrides?.locations?.[ref.locationId] ?? {};
    const co = sim.overrides?.combos?.[comboKey(ref.modelId, ref.locationId)] ?? {};
    const lotCost = lo.lotCost ?? (ml.location.lotCostEstimate == null ? null : Number(ml.location.lotCostEstimate));
    const costContractor = co.costContractor ?? (ml.costContractor == null ? null : Number(ml.costContractor));
    const costOpenBook = co.costOpenBook ?? (ml.costOpenBook == null ? null : Number(ml.costOpenBook));
    const costPerformance = co.costPerformance ?? (ml.costPerformance == null ? null : Number(ml.costPerformance));
    if (lotCost == null)
      return { error: `Set the estimated lot cost for ${ml.location.name} in the catalog.` };
    if (sim.compMode === "CONTRACTOR_FEE" && costContractor == null)
      return { error: `Set the contractor cost for ${ml.model.name} at ${ml.location.name} in the catalog.` };
    if (sim.fundingMode === "BANK" && costContractor == null)
      return {
        error: `Set the contractor cost for ${ml.model.name} at ${ml.location.name} — é a base do orçamento do banco (LTC = contractor + fee + lote).`,
      };
    if (sim.compMode === "OPEN_BOOK" && costOpenBook == null)
      return { error: `Set the open book cost for ${ml.model.name} at ${ml.location.name} in the catalog.` };
    if (
      (sim.compMode === "PERFORMANCE" || sim.compMode === "PROMOTE") &&
      costPerformance == null
    )
      return { error: `Set the performance cost for ${ml.model.name} at ${ml.location.name} in the catalog.` };
    const cycle = Math.max(1, Math.round(Number(ref.cycle ?? 1)) || 1);
    units.push({
      cycle,
      // prefixo do ciclo no label → aparece em TODAS as linhas do ledger e nas tabelas
      label: `${hasCycles ? `C${cycle} • ` : ""}${ml.model.name} — ${ml.location.name}`,
      locationName: ml.location.name,
      modelName: ml.model.name,
      permitDays: lo.permitDays ?? ml.location.permitDays,
      lotLeadDays: lo.lotLeadDays ?? ml.location.lotLeadDays,
      saleDays: lo.saleDays ?? ml.location.saleDays,
      buildMonths: co.buildMonths ?? Number(ml.model.buildMonths),
      costPerformance: costPerformance ?? 0,
      costContractor: costContractor ?? 0,
      costOpenBook: costOpenBook ?? 0,
      contractorFee: co.contractorFee ?? Number(ml.model.contractorFee ?? fees.get(ml.model.houseType) ?? 0),
      lotCost,
      salePrice: co.salePrice ?? Number(ml.salePrice),
    });
  }
  if (units.length === 0) return { error: "Add at least one house to simulate." };

  // Custos do veículo: só quando a LLC é da Vixus; entidade do cliente arca fora do programa
  const vehicleCosts =
    (sim.vehicleStructure ?? "VIXUS_MANAGED") === "VIXUS_MANAGED"
      ? (await prisma.catalogVehicleCost.findMany({ orderBy: { sortOrder: "asc" } })).map((c) => ({
          name: c.name,
          amount: sim.overrides?.vehicleCosts?.[c.id] ?? Number(c.amount),
          timing: c.timing as "FORMATION" | "DISSOLUTION" | "ANNUAL" | "MONTHLY",
        }))
      : null;

  return {
    fundingMode: sim.fundingMode as "EQUITY" | "BANK",
    upfrontFunding: sim.upfrontFunding ?? false,
    compMode: sim.compMode as "CONTRACTOR_FEE" | "PERFORMANCE" | "PROMOTE" | "OPEN_BOOK",
    perfPct: Number(sim.perfPct) / 100,
    perfTiming: sim.perfTiming === "PER_SALE" ? "PER_SALE" : "PROJECT_COMPLETION",
    promoteTiers: sim.promoteTiers,
    flatFeePerHouse: Number(sim.flatFeePerHouse ?? 0),
    paymentPlan:
      sim.paymentPlan === "LIGHT_START" || sim.paymentPlan === "PARTNER"
        ? sim.paymentPlan
        : "STANDARD",
    equityGatePct: Number(sim.equityGatePct) / 100,
    // gap entre início das casas vem do CENÁRIO (Ótimo 10 · Real 20 · Conservador 30);
    // a grade da aba Premissas pode sobrescrever POR CENÁRIO (so.<campo> ?? catálogo)
    unitGapDays: so.unitGapDays ?? scenario.unitGapDays,
    scenario: {
      salePriceBufferPct: so.salePriceBufferPct ?? Number(scenario.salePriceBufferPct),
      constructionCostBufferPct:
        so.constructionCostBufferPct ?? Number(scenario.constructionCostBufferPct),
      lotCostBufferPct: so.lotCostBufferPct ?? Number(scenario.lotCostBufferPct),
      closingFeePct: so.closingFeePct ?? Number(scenario.closingFeePct),
      contingencyReservePct: so.contingencyReservePct ?? Number(scenario.contingencyReservePct),
      landAcquisitionDays: so.landAcquisitionDays ?? scenario.landAcquisitionDays,
      saleClosingDays: so.saleClosingDays ?? scenario.saleClosingDays,
      constructionDurationBufferM:
        so.constructionDurationBufferM ?? Number(scenario.constructionDurationBufferM),
      salesAbsorptionMonths:
        so.salesAbsorptionMonths ??
        (scenario.salesAbsorptionMonths == null ? null : Number(scenario.salesAbsorptionMonths)),
      emdPct: so.emdPct ?? Number(scenario.emdPct),
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
    vehicleCosts,
  };
}
