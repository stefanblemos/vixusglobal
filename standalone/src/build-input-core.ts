import type { SimBank, SimInput, SimUnitInput } from "./simulator";

// NÚCLEO PURO do build-sim-input (15/07): monta o SimInput a partir de DADOS DE CATÁLOGO
// passados como argumento — nenhum acesso a banco. É este arquivo (junto do simulator.ts,
// phases.ts e do report) que vai no pacote standalone p/ a plataforma da 4U; o app usa o
// wrapper build-sim-input.ts, que busca os mesmos dados no Prisma e delega para cá.
// REGRA: nada de import de @/lib/db ou @prisma aqui — o pacote precisa rodar sozinho.

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

// ── Dados de catálogo em formato PLANO (números já convertidos de Decimal) ──

export type CatalogScenarioData = {
  code: string;
  name: string;
  unitGapDays: number;
  salePriceBufferPct: number;
  constructionCostBufferPct: number;
  lotCostBufferPct: number;
  closingFeePct: number;
  contingencyReservePct: number;
  landAcquisitionDays: number;
  saleClosingDays: number;
  constructionDurationBufferM: number;
  salesAbsorptionMonths: number | null;
  emdPct: number;
};

// Uma COMBINAÇÃO modelo×location com os campos do location embutidos — é a linha que o
// motor consome. Espelha CatalogModelLocation + CatalogModel + CatalogLocation.
export type CatalogComboData = {
  modelId: string;
  locationId: string;
  modelName: string;
  locationName: string;
  houseType: string;
  buildMonths: number;
  contractorFeeOverride: number | null; // CatalogModel.contractorFee (null = fee do tipo)
  salePrice: number;
  costPerformance: number | null;
  costContractor: number | null;
  costOpenBook: number | null;
  // do location
  permitDays: number;
  lotLeadDays: number;
  saleDays: number;
  lotCostEstimate: number | null;
};

export type CatalogBankFeeData = {
  name: string;
  timing: SimBank["customFees"][number]["timing"];
  kind: SimBank["customFees"][number]["kind"];
  amount: number;
};

export type CatalogBankData = {
  ltcBuildPct: number;
  ltcLandPct: number;
  financeLand: boolean;
  ltvPct: number;
  haircutPct: number;
  perUnitCap: number | null;
  closingPermitPct: number;
  rateType: string; // FIXED | FLOAT
  aprPct: number;
  indexPct: number;
  spreadPct: number;
  interestBasis: SimBank["interestBasis"];
  originationPct: number;
  originationFlat: number;
  brokerPct: number;
  titleEscrowPct: number;
  closingFeePct: number;
  processingFee: number;
  budgetReviewFee: number;
  appraisalFee: number;
  legalFee: number;
  feesFinanced: boolean;
  servicingMonthly: number;
  inspectionFeePerDraw: number;
  drawProcessingFee: number;
  achFeePerBatch: number;
  hasInterestReserve: boolean;
  reserveMonths: number;
  reserveInEnvelope: boolean;
  overfundingMode: SimBank["overfundingMode"];
  releaseMode: SimBank["releaseMode"];
  sweepPct: number;
  reconveyanceFee: number;
  termMonths: number;
  extensionFeePct: number;
  customFees: CatalogBankFeeData[];
};

export type CatalogVehicleCostData = {
  id: string;
  name: string;
  amount: number;
  timing: "FORMATION" | "DISSOLUTION" | "ANNUAL" | "MONTHLY";
};

export type CatalogData = {
  scenario: CatalogScenarioData;
  combos: CatalogComboData[]; // pelo menos as combinações referenciadas pela cesta
  houseTypeFees: Record<string, number>; // fee por HouseType
  bank: CatalogBankData | null; // obrigatório quando fundingMode = BANK
  vehicleCosts: CatalogVehicleCostData[]; // custos do veículo (usados só em VIXUS_MANAGED)
};

export type SimFields = {
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
  vehicleStructure?: string; // VIXUS_MANAGED (default) | CLIENT_ENTITY — só rótulo/estrutura
  // custos do veículo valem INDEPENDENTEMENTE da estrutura (16/07); true = SEM empresa
  // nova (ex.: própria Vixus como veículo, ou entidade existente do cliente) → NENHUM
  // custo de entidade entra na projeção — abertura, anuais, contador e encerramento são
  // absorvidos pela estrutura existente (correção do Stefan 16/07)
  waiveFormationCost?: boolean;
};

// Monta o SimInput a partir dos dados de catálogo fornecidos. Mesmas regras e mensagens
// de erro do fluxo original — o wrapper com Prisma delega para cá.
export function buildSimInputCore(
  sim: SimFields,
  catalog: CatalogData,
): SimInput | { error: string } {
  const scenario = catalog.scenario;
  // overrides da grade de cenário (aba Premissas) para ESTE cenário
  const so = sim.overrides?.scenarios?.[sim.scenarioCode] ?? {};
  const bank = catalog.bank;
  if (sim.fundingMode === "BANK" && !bank) return { error: "Pick a bank profile for bank funding." };

  const fees = new Map(Object.entries(catalog.houseTypeFees));
  const byKey = new Map(catalog.combos.map((c) => [comboKey(c.modelId, c.locationId), c]));
  // Esteira de ciclos é só para EQUITY — no banco, um ciclo por LLC/loan (regra do Stefan)
  const hasCycles = sim.units.some((u) => (u.cycle ?? 1) > 1);
  if (sim.fundingMode === "BANK" && hasCycles)
    return { error: "Ciclos são só para equity — com banco, use um ciclo (uma LLC/loan por ciclo)." };
  const units: SimUnitInput[] = [];
  for (const ref of sim.units) {
    const ml = byKey.get(comboKey(ref.modelId, ref.locationId));
    if (!ml) return { error: "A selected model is not available in the selected location." };
    // Premissas da simulação (aba Premissas): override ?? catálogo, campo a campo
    const lo = sim.overrides?.locations?.[ref.locationId] ?? {};
    const co = sim.overrides?.combos?.[comboKey(ref.modelId, ref.locationId)] ?? {};
    const lotCost = lo.lotCost ?? ml.lotCostEstimate;
    const costContractor = co.costContractor ?? ml.costContractor;
    const costOpenBook = co.costOpenBook ?? ml.costOpenBook;
    const costPerformance = co.costPerformance ?? ml.costPerformance;
    if (lotCost == null)
      return { error: `Set the estimated lot cost for ${ml.locationName} in the catalog.` };
    if (sim.compMode === "CONTRACTOR_FEE" && costContractor == null)
      return { error: `Set the contractor cost for ${ml.modelName} at ${ml.locationName} in the catalog.` };
    if (sim.fundingMode === "BANK" && costContractor == null)
      return {
        error: `Set the contractor cost for ${ml.modelName} at ${ml.locationName} — é a base do orçamento do banco (LTC = contractor + fee + lote).`,
      };
    if (sim.compMode === "OPEN_BOOK" && costOpenBook == null)
      return { error: `Set the open book cost for ${ml.modelName} at ${ml.locationName} in the catalog.` };
    if ((sim.compMode === "PERFORMANCE" || sim.compMode === "PROMOTE") && costPerformance == null)
      return { error: `Set the performance cost for ${ml.modelName} at ${ml.locationName} in the catalog.` };
    const cycle = Math.max(1, Math.round(Number(ref.cycle ?? 1)) || 1);
    units.push({
      cycle,
      // prefixo do ciclo no label → aparece em TODAS as linhas do ledger e nas tabelas
      label: `${hasCycles ? `C${cycle} • ` : ""}${ml.modelName} — ${ml.locationName}`,
      locationName: ml.locationName,
      modelName: ml.modelName,
      permitDays: lo.permitDays ?? ml.permitDays,
      lotLeadDays: lo.lotLeadDays ?? ml.lotLeadDays,
      saleDays: lo.saleDays ?? ml.saleDays,
      buildMonths: co.buildMonths ?? ml.buildMonths,
      costPerformance: costPerformance ?? 0,
      costContractor: costContractor ?? 0,
      costOpenBook: costOpenBook ?? 0,
      contractorFee: co.contractorFee ?? ml.contractorFeeOverride ?? fees.get(ml.houseType) ?? 0,
      lotCost,
      salePrice: co.salePrice ?? ml.salePrice,
    });
  }
  if (units.length === 0) return { error: "Add at least one house to simulate." };

  // Custos do veículo: existem independentemente da estrutura (16/07) — abrir/manter
  // entidade custa. Waiver marcado = SEM empresa nova → NENHUM custo de entidade na
  // projeção (abertura, anuais, contador, encerramento absorvidos pela estrutura existente).
  const vehicleCostList = sim.waiveFormationCost
    ? []
    : catalog.vehicleCosts.map((c) => ({
        name: c.name,
        amount: sim.overrides?.vehicleCosts?.[c.id] ?? c.amount,
        timing: c.timing,
      }));
  const vehicleCosts = vehicleCostList.length > 0 ? vehicleCostList : null;

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
    // gap entre CAUÇÕES de lote vem do CENÁRIO (Ótimo 10 · Real 20 · Conservador 30);
    // a grade da aba Premissas pode sobrescrever POR CENÁRIO (so.<campo> ?? catálogo)
    unitGapDays: so.unitGapDays ?? scenario.unitGapDays,
    scenario: {
      salePriceBufferPct: so.salePriceBufferPct ?? scenario.salePriceBufferPct,
      constructionCostBufferPct:
        so.constructionCostBufferPct ?? scenario.constructionCostBufferPct,
      lotCostBufferPct: so.lotCostBufferPct ?? scenario.lotCostBufferPct,
      closingFeePct: so.closingFeePct ?? scenario.closingFeePct,
      contingencyReservePct: so.contingencyReservePct ?? scenario.contingencyReservePct,
      landAcquisitionDays: so.landAcquisitionDays ?? scenario.landAcquisitionDays,
      saleClosingDays: so.saleClosingDays ?? scenario.saleClosingDays,
      constructionDurationBufferM:
        so.constructionDurationBufferM ?? scenario.constructionDurationBufferM,
      salesAbsorptionMonths: so.salesAbsorptionMonths ?? scenario.salesAbsorptionMonths,
      emdPct: so.emdPct ?? scenario.emdPct,
    },
    bank: bank
      ? {
          ltcBuildPct: bank.ltcBuildPct,
          ltcLandPct: bank.ltcLandPct,
          financeLand: bank.financeLand,
          ltvPct: bank.ltvPct,
          haircutPct: bank.haircutPct,
          perUnitCap: bank.perUnitCap,
          closingPermitPct: bank.closingPermitPct,
          effectiveAprPct: bank.rateType === "FIXED" ? bank.aprPct : bank.indexPct + bank.spreadPct,
          interestBasis: bank.interestBasis,
          originationPct: bank.originationPct,
          originationFlat: bank.originationFlat,
          brokerPct: bank.brokerPct,
          titleEscrowPct: bank.titleEscrowPct,
          closingFeePct: bank.closingFeePct,
          processingFee: bank.processingFee,
          budgetReviewFee: bank.budgetReviewFee,
          appraisalFee: bank.appraisalFee,
          legalFee: bank.legalFee,
          feesFinanced: bank.feesFinanced,
          servicingMonthly: bank.servicingMonthly,
          inspectionFeePerDraw: bank.inspectionFeePerDraw,
          drawProcessingFee: bank.drawProcessingFee,
          achFeePerBatch: bank.achFeePerBatch,
          hasInterestReserve: bank.hasInterestReserve,
          reserveMonths: bank.reserveMonths,
          reserveInEnvelope: bank.reserveInEnvelope,
          overfundingMode: bank.overfundingMode,
          releaseMode: bank.releaseMode,
          sweepPct: bank.sweepPct,
          reconveyanceFee: bank.reconveyanceFee,
          termMonths: bank.termMonths,
          extensionFeePct: bank.extensionFeePct,
          // extensão só entra no cenário Conservador (regra do Stefan — na prática, não)
          applyExtensionFee: sim.scenarioCode === "CONS",
          customFees: bank.customFees.map((f) => ({
            name: f.name,
            timing: f.timing,
            kind: f.kind,
            amount: f.amount,
          })),
        }
      : null,
    units,
    vehicleCosts,
  };
}
