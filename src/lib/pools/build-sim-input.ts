import { prisma } from "@/lib/db";
import type { SimInput } from "@/lib/pools/simulator";
import {
  buildSimInputCore,
  comboKey,
  countOverrides,
  type CatalogBankData,
  type CatalogComboData,
  type CatalogData,
  type CatalogScenarioData,
  type CatalogVehicleCostData,
  type SimFields,
} from "@/lib/pools/build-input-core";

// WRAPPER Prisma do build-sim-input (15/07): busca os dados de catálogo no banco e delega
// a montagem ao NÚCLEO PURO (build-input-core.ts) — que é o arquivo que vai no pacote
// standalone da 4U. Toda regra de negócio mora no core; aqui só há fetch + conversão
// Decimal→number. Tipos re-exportados para os call sites existentes não mudarem.

export { comboKey, countOverrides };
export type {
  ComboOverride,
  LocationOverride,
  PromoteTierInput,
  ScenarioOverride,
  SimOverrides,
  UnitRef,
} from "@/lib/pools/build-input-core";

type MlRow = Awaited<ReturnType<typeof fetchMls>>[number];

function fetchMls(where: { modelId_locationId?: { modelId: string; locationId: string } } | { locationId: { in: string[] } }) {
  return prisma.catalogModelLocation.findMany({
    where: where as never,
    include: { model: true, location: true },
  });
}

function toCombo(ml: MlRow): CatalogComboData {
  return {
    modelId: ml.modelId,
    locationId: ml.locationId,
    modelName: ml.model.name,
    locationName: ml.location.name,
    houseType: ml.model.houseType as string,
    buildMonths: Number(ml.model.buildMonths),
    contractorFeeOverride: ml.model.contractorFee == null ? null : Number(ml.model.contractorFee),
    salePrice: Number(ml.salePrice),
    costPerformance: ml.costPerformance == null ? null : Number(ml.costPerformance),
    costContractor: ml.costContractor == null ? null : Number(ml.costContractor),
    costOpenBook: ml.costOpenBook == null ? null : Number(ml.costOpenBook),
    permitDays: ml.location.permitDays,
    lotLeadDays: ml.location.lotLeadDays,
    saleDays: ml.location.saleDays,
    lotCostEstimate: ml.location.lotCostEstimate == null ? null : Number(ml.location.lotCostEstimate),
  };
}

async function fetchCatalogBank(bankProfileId: string | null): Promise<CatalogBankData | null> {
  if (!bankProfileId) return null;
  const bankRow = await prisma.bankProfile.findUnique({
    where: { id: bankProfileId },
    include: { customFees: true },
  });
  if (!bankRow) return null;
  return {
    ltcBuildPct: Number(bankRow.ltcBuildPct),
    ltcLandPct: Number(bankRow.ltcLandPct),
    financeLand: bankRow.financeLand,
    ltvPct: Number(bankRow.ltvPct),
    haircutPct: Number(bankRow.haircutPct),
    perUnitCap: bankRow.perUnitCap == null ? null : Number(bankRow.perUnitCap),
    closingPermitPct: Number(bankRow.closingPermitPct),
    rateType: bankRow.rateType as string,
    aprPct: Number(bankRow.aprPct),
    indexPct: Number(bankRow.indexPct),
    spreadPct: Number(bankRow.spreadPct),
    interestBasis: bankRow.interestBasis,
    originationPct: Number(bankRow.originationPct),
    originationFlat: Number(bankRow.originationFlat),
    brokerPct: Number(bankRow.brokerPct),
    titleEscrowPct: Number(bankRow.titleEscrowPct),
    closingFeePct: Number(bankRow.closingFeePct),
    processingFee: Number(bankRow.processingFee),
    budgetReviewFee: Number(bankRow.budgetReviewFee),
    appraisalFee: Number(bankRow.appraisalFee),
    legalFee: Number(bankRow.legalFee),
    feesFinanced: bankRow.feesFinanced,
    servicingMonthly: Number(bankRow.servicingMonthly),
    inspectionFeePerDraw: Number(bankRow.inspectionFeePerDraw),
    drawProcessingFee: Number(bankRow.drawProcessingFee),
    achFeePerBatch: Number(bankRow.achFeePerBatch),
    hasInterestReserve: bankRow.hasInterestReserve,
    reserveMonths: Number(bankRow.reserveMonths),
    reserveInEnvelope: bankRow.reserveInEnvelope,
    overfundingMode: bankRow.overfundingMode,
    releaseMode: bankRow.releaseMode,
    sweepPct: Number(bankRow.sweepPct),
    reconveyanceFee: Number(bankRow.reconveyanceFee),
    termMonths: bankRow.termMonths,
    extensionFeePct: Number(bankRow.extensionFeePct),
    customFees: bankRow.customFees.map((f) => ({
      name: f.name,
      timing: f.timing,
      kind: f.kind,
      amount: Number(f.amount),
    })),
  };
}

function toScenario(scenario: NonNullable<Awaited<ReturnType<typeof prisma.bufferScenario.findUnique>>>): CatalogScenarioData {
  return {
    code: scenario.code,
    name: scenario.name,
    unitGapDays: scenario.unitGapDays,
    salePriceBufferPct: Number(scenario.salePriceBufferPct),
    constructionCostBufferPct: Number(scenario.constructionCostBufferPct),
    lotCostBufferPct: Number(scenario.lotCostBufferPct),
    closingFeePct: Number(scenario.closingFeePct),
    contingencyReservePct: Number(scenario.contingencyReservePct),
    landAcquisitionDays: scenario.landAcquisitionDays,
    saleClosingDays: scenario.saleClosingDays,
    constructionDurationBufferM: Number(scenario.constructionDurationBufferM),
    salesAbsorptionMonths:
      scenario.salesAbsorptionMonths == null ? null : Number(scenario.salesAbsorptionMonths),
    emdPct: Number(scenario.emdPct),
  };
}

async function fetchVehicleCosts(): Promise<CatalogVehicleCostData[]> {
  const rows = await prisma.catalogVehicleCost.findMany({ orderBy: { sortOrder: "asc" } });
  return rows.map((c) => ({
    id: c.id,
    name: c.name,
    amount: Number(c.amount),
    timing: c.timing as "FORMATION" | "DISSOLUTION" | "ANNUAL" | "MONTHLY",
  }));
}

async function fetchHouseTypeFees(): Promise<Record<string, number>> {
  const feeRows = await prisma.houseTypeFee.findMany();
  return Object.fromEntries(feeRows.map((f) => [f.type as string, Number(f.fee)]));
}

// Monta o SimInput a partir dos catálogos atuais (valores sempre frescos do banco).
// Módulo neutro: usado pelas server actions E pelos server components (cards de cenário).
export async function buildSimInput(sim: SimFields): Promise<SimInput | { error: string }> {
  const scenario = await prisma.bufferScenario.findUnique({ where: { code: sim.scenarioCode } });
  if (!scenario) return { error: "Scenario not found." };

  if (sim.fundingMode === "BANK" && !sim.bankProfileId)
    return { error: "Pick a bank profile for bank funding." };
  const bank = await fetchCatalogBank(sim.bankProfileId);
  if (sim.fundingMode === "BANK" && !bank) return { error: "Pick a bank profile for bank funding." };

  // Só as combinações que a cesta referencia — o core valida a existência de cada uma
  const refs = [...new Set(sim.units.map((u) => comboKey(u.modelId, u.locationId)))];
  const combos: CatalogComboData[] = [];
  for (const key of refs) {
    const [modelId, locationId] = key.split("|");
    const ml = await prisma.catalogModelLocation.findUnique({
      where: { modelId_locationId: { modelId, locationId } },
      include: { model: true, location: true },
    });
    if (!ml) continue; // core devolve o erro canônico de combinação ausente
    combos.push(toCombo(ml));
  }

  const catalog: CatalogData = {
    scenario: toScenario(scenario),
    combos,
    houseTypeFees: await fetchHouseTypeFees(),
    bank,
    vehicleCosts: await fetchVehicleCosts(),
  };

  return buildSimInputCore(sim, catalog);
}

// Catálogo COMPLETO de um conjunto de locais (todos os combos) — usado pelo OTIMIZADOR,
// que precisa enxergar todos os modelos elegíveis, não só os já referenciados numa cesta.
export async function buildCatalogForLocations(
  locationIds: string[],
  scenarioCode: string,
  bankProfileId: string | null,
): Promise<CatalogData | { error: string }> {
  const scenario = await prisma.bufferScenario.findUnique({ where: { code: scenarioCode } });
  if (!scenario) return { error: "Scenario not found." };
  const bank = await fetchCatalogBank(bankProfileId);
  const mls = await fetchMls({ locationId: { in: locationIds } });
  return {
    scenario: toScenario(scenario),
    combos: mls.map(toCombo),
    houseTypeFees: await fetchHouseTypeFees(),
    bank,
    vehicleCosts: await fetchVehicleCosts(),
  };
}
