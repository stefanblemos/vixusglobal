"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { simulate } from "@/lib/pools/simulator";
import { buildCatalogForLocations, buildSimInput, type PromoteTierInput, type UnitRef } from "@/lib/pools/build-sim-input";
import {
  evaluateProgram,
  optimizeProgram,
  type BasketLine,
  type Diversity,
  type OptimizerResult,
  type OptimizerSettings,
  type ProgramEval,
  type ProgramKpis,
} from "@/lib/pools/optimizer";
import { generateProgramRationale, type ProgramGrounding, type ProgramRationale } from "@/lib/pools/program-ai";
import { BuilderCompMode, SimFundingMode } from "@prisma/client";

const cycleQty = (cycle1: number, cycle: number, growth: number) =>
  Math.max(0, Math.round(cycle1 * Math.pow(growth, cycle - 1)));

// Justificativa por IA: monta o grounding com os números REAIS e chama a Claude.
export async function explainProgramAction(input: {
  lines: BasketLine[];
  growth: number;
  kpis: ProgramKpis;
  peak: number;
  durationMonths: number;
  equityTarget: number;
  horizonMonths: number;
  fundingMode: "EQUITY" | "BANK";
  diversity: Diversity;
}): Promise<ProgramRationale | { error: string }> {
  const kept = input.lines.filter((l) => l.cycle1 > 0);
  if (kept.length === 0) return { error: "Cesta vazia." };
  const grounding: ProgramGrounding = {
    equityTarget: input.equityTarget,
    horizonMonths: input.horizonMonths,
    fundingMode: input.fundingMode,
    diversity: input.diversity,
    growth: input.growth,
    kpis: {
      irrAnnual: input.kpis.irrAnnual,
      profit: Math.round(input.kpis.profit),
      equityMultiple: input.kpis.equityMultiple,
      peakCapital: Math.round(input.peak),
      durationMonths: input.durationMonths,
    },
    basket: kept.map((l) => ({
      location: l.locationName,
      model: l.modelName,
      housesPerCycle: Array.from({ length: l.cycles }, (_, c) => cycleQty(l.cycle1, c + 1, input.growth)),
      equityPerUnit: Math.round(l.eqUnit),
      marginPerUnit: Math.round(l.profitUnit),
      cycleDays: l.cycleDays,
      absorptionPerYear: l.perYear,
      absorptionSource: l.source,
      capConcurrent: l.cap,
      overAbsorption: l.over,
    })),
  };
  const r = await generateProgramRationale(grounding);
  return r ?? { error: "A IA não retornou a justificativa (verifique a chave da API)." };
}

// Settings comuns aos três fluxos (o cliente manda como objeto simples, JSON-serializável)
export type OptimizerPayloadSettings = {
  fundingMode: "EQUITY" | "BANK";
  bankProfileId: string | null;
  scenarioCode: string;
  compMode: string;
  perfPct: number;
  perfTiming: string;
  promoteTiers: PromoteTierInput[] | null;
  paymentPlan: string;
  equityGatePct: number;
  unitGapDays: number;
  flatFeePerHouse: number;
  vehicleStructure: string;
  waiveFormationCost: boolean;
};

function toSettings(s: OptimizerPayloadSettings): OptimizerSettings {
  return {
    fundingMode: s.fundingMode,
    bankProfileId: s.fundingMode === "BANK" ? s.bankProfileId : null,
    scenarioCode: s.scenarioCode,
    compMode: s.compMode,
    perfPct: s.perfPct,
    perfTiming: s.perfTiming,
    promoteTiers: s.promoteTiers,
    paymentPlan: s.paymentPlan,
    equityGatePct: s.equityGatePct,
    unitGapDays: s.unitGapDays,
    flatFeePerHouse: s.flatFeePerHouse,
    vehicleStructure: s.vehicleStructure,
    waiveFormationCost: s.waiveFormationCost,
  };
}

// 1 · Busca a cesta ótima (abertura do modal)
export async function optimizeProgramAction(input: {
  equityTarget: number;
  horizonMonths: number;
  locationIds: string[];
  sharePct?: number;
  diversity?: Diversity;
  reinvest?: boolean;
  settings: OptimizerPayloadSettings;
}): Promise<OptimizerResult | { error: string }> {
  if (!(input.equityTarget > 0)) return { error: "Informe o volume de equity do grupo." };
  if (!(input.horizonMonths > 0)) return { error: "Informe o horizonte em meses." };
  if (input.locationIds.length === 0) return { error: "Escolha ao menos um local." };

  const settings = toSettings(input.settings);
  const catalog = await buildCatalogForLocations(
    input.locationIds,
    settings.scenarioCode,
    settings.bankProfileId,
  );
  if ("error" in catalog) return { error: catalog.error };

  const locs = await prisma.catalogLocation.findMany({
    where: { id: { in: input.locationIds } },
    select: { id: true, absorptionPerYear: true },
  });
  const absorptionByLocation: Record<string, number | null> = {};
  for (const l of locs) absorptionByLocation[l.id] = l.absorptionPerYear;

  return optimizeProgram(catalog, {
    equityTarget: input.equityTarget,
    horizonMonths: input.horizonMonths,
    locationIds: input.locationIds,
    sharePct: input.sharePct,
    diversity: input.diversity,
    reinvest: input.reinvest,
    absorptionByLocation,
    settings,
  });
}

// 2 · Recalcula uma cesta editada (troca de modelo / quantidade no modal)
export async function evaluateProgramAction(input: {
  lines: BasketLine[];
  growth?: number;
  settings: OptimizerPayloadSettings;
}): Promise<ProgramEval> {
  const settings = toSettings(input.settings);
  const locationIds = [...new Set(input.lines.map((l) => l.locationId))];
  const catalog = await buildCatalogForLocations(locationIds, settings.scenarioCode, settings.bankProfileId);
  if ("error" in catalog)
    return { kpis: emptyEvalKpis(), peak: 0, bankCommitted: 0, durationMonths: 0, cycles: [], error: catalog.error };
  // Re-flag da absorção nas linhas editadas (cap conhecido no cliente, reconfirmado aqui)
  const lines = input.lines.map((l) => ({ ...l, over: l.cap != null && l.cycle1 > l.cap }));
  return evaluateProgram(catalog, settings, lines, input.growth ?? 1);
}

// 3 · Fecha o modal → grava uma PoolSimulation NORMAL (alimenta report/cronograma/tudo)
export async function saveOptimizedSimulation(input: {
  name: string;
  poolId: string | null;
  units: UnitRef[];
  settings: OptimizerPayloadSettings;
  rationale?: ProgramRationale | null;
}): Promise<{ error: string } | void> {
  const name = input.name.trim();
  if (!name) return { error: "Dê um nome ao programa." };
  if (input.units.length === 0) return { error: "A cesta está vazia." };

  const s = input.settings;
  const sim = {
    fundingMode: s.fundingMode,
    compMode: s.compMode,
    perfPct: s.perfPct,
    perfTiming: s.perfTiming,
    promoteTiers: s.promoteTiers,
    flatFeePerHouse: s.flatFeePerHouse,
    paymentPlan: s.paymentPlan,
    equityGatePct: s.equityGatePct,
    unitGapDays: s.unitGapDays,
    scenarioCode: s.scenarioCode,
    bankProfileId: s.fundingMode === "BANK" ? s.bankProfileId : null,
    vehicleStructure: s.vehicleStructure,
    waiveFormationCost: s.waiveFormationCost,
    units: input.units,
  };
  if (sim.compMode === "PROMOTE" && !sim.promoteTiers)
    return { error: "Defina pelo menos um tier do promote." };

  const built = await buildSimInput(sim);
  if ("error" in built) return { error: built.error };
  const result = simulate(built);

  const row = await prisma.poolSimulation.create({
    data: {
      name,
      poolId: input.poolId,
      fundingMode: s.fundingMode as SimFundingMode,
      compMode: s.compMode as BuilderCompMode,
      perfPct: s.perfPct,
      perfTiming: s.perfTiming,
      promoteTiers: s.promoteTiers ?? undefined,
      flatFeePerHouse: s.flatFeePerHouse,
      paymentPlan: s.paymentPlan as "STANDARD" | "LIGHT_START" | "PARTNER",
      equityGatePct: s.equityGatePct,
      unitGapDays: s.unitGapDays,
      scenarioCode: s.scenarioCode,
      bankProfileId: s.fundingMode === "BANK" ? s.bankProfileId : null,
      vehicleStructure: s.vehicleStructure === "CLIENT_ENTITY" ? "CLIENT_ENTITY" : "VIXUS_MANAGED",
      waiveFormationCost: s.waiveFormationCost,
      units: input.units as object[],
      result: JSON.parse(JSON.stringify(result)),
      // justificativa por IA guardada junto (flui p/ o report); namespaced p/ não colidir
      // com a prosa do report ({en,pt,es})
      reportAi: input.rationale ? { programRationale: JSON.parse(JSON.stringify(input.rationale)) } : undefined,
    },
  });
  revalidatePath("/pools/simulator");
  redirect(`/pools/simulator/${row.id}`);
}

function emptyEvalKpis(): ProgramEval["kpis"] {
  return {
    totalInvested: 0, totalReturned: 0, profit: 0, irrAnnual: null, irrMonthly: null,
    equityMultiple: null, peakCapital: 0, durationDays: 0, perfFeeTotal: 0, promoteTotal: 0,
    contractorFeeTotal: 0, bankCommitted: 0, bankUpfrontFees: 0, bankInterestTotal: 0,
    bankOtherFees: 0, bankReserveFunded: 0, bankReserveUnused: 0, bankExtensionFee: 0,
    cashToClosing: 0, equityGateAmount: 0, loanClosingDay: null, vehicleCostTotal: 0,
  };
}
