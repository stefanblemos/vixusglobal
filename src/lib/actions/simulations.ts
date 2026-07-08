"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { simulate, type SimInput, type SimUnitInput } from "@/lib/pools/simulator";
import type { BuilderCompMode, SimFundingMode } from "@prisma/client";

export type FormState = { error?: string } | undefined;

type UnitRef = { locationId: string; modelId: string };

// Monta o SimInput a partir dos catálogos atuais (valores sempre frescos do banco).
async function buildSimInput(sim: {
  fundingMode: string;
  compMode: string;
  perfPct: unknown;
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
    ? await prisma.bankProfile.findUnique({ where: { id: sim.bankProfileId } })
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
    const perfMode = sim.compMode === "PERFORMANCE";
    if (perfMode && ml.costPerformance == null)
      return { error: `Set the performance cost for ${ml.model.name} at ${ml.location.name} in the catalog.` };
    if (!perfMode && ml.costContractor == null)
      return { error: `Set the contractor cost for ${ml.model.name} at ${ml.location.name} in the catalog.` };
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
      contractorFee: Number(ml.model.contractorFee ?? fees.get(ml.model.houseType) ?? 0),
      lotCost: Number(lotCost),
      salePrice: Number(ml.salePrice),
    });
  }
  if (units.length === 0) return { error: "Add at least one house to simulate." };

  return {
    fundingMode: sim.fundingMode as "EQUITY" | "BANK",
    compMode: sim.compMode as "CONTRACTOR_FEE" | "PERFORMANCE",
    perfPct: Number(sim.perfPct) / 100,
    perfTiming: "PROJECT_COMPLETION",
    equityGatePct: Number(sim.equityGatePct) / 100,
    parallelPermit: sim.parallelPermit,
    unitGapDays: sim.unitGapDays,
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
          aprPct: Number(bank.aprPct),
          originationPct: Number(bank.originationPct),
          originationFlat: Number(bank.originationFlat),
          closingFeePct: Number(bank.closingFeePct),
          appraisalFee: Number(bank.appraisalFee),
          legalFee: Number(bank.legalFee),
          inspectionFeePerDraw: Number(bank.inspectionFeePerDraw),
          servicingMonthly: Number(bank.servicingMonthly),
          hasInterestReserve: bank.hasInterestReserve,
          feesFinanced: bank.feesFinanced,
        }
      : null,
    units,
  };
}

function parseUnits(raw: string): UnitRef[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((u) => u && typeof u.locationId === "string" && typeof u.modelId === "string")
      .map((u) => ({ locationId: u.locationId, modelId: u.modelId }));
  } catch {
    return [];
  }
}

export async function createSimulation(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };
  const units = parseUnits(String(formData.get("units") ?? "[]"));
  if (units.length === 0) return { error: "Add at least one house." };

  const sim = {
    fundingMode: String(formData.get("fundingMode") ?? "BANK"),
    compMode: String(formData.get("compMode") ?? "PERFORMANCE"),
    perfPct: Number(formData.get("perfPct") ?? 35),
    equityGatePct: Number(formData.get("equityGatePct") ?? 10),
    parallelPermit: formData.get("parallelPermit") === "on",
    unitGapDays: Number(formData.get("unitGapDays") ?? 3) || 3,
    scenarioCode: String(formData.get("scenarioCode") ?? "REAL"),
    bankProfileId: String(formData.get("bankProfileId") ?? "").trim() || null,
    poolId: String(formData.get("poolId") ?? "").trim() || null,
    units,
  };
  const input = await buildSimInput(sim);
  if ("error" in input) return { error: input.error };
  const result = simulate(input);

  const row = await prisma.poolSimulation.create({
    data: {
      name,
      poolId: sim.poolId,
      fundingMode: sim.fundingMode as SimFundingMode,
      compMode: sim.compMode as BuilderCompMode,
      perfPct: sim.perfPct,
      equityGatePct: sim.equityGatePct,
      parallelPermit: sim.parallelPermit,
      unitGapDays: sim.unitGapDays,
      scenarioCode: sim.scenarioCode,
      bankProfileId: sim.fundingMode === "BANK" ? sim.bankProfileId : null,
      units: units as object[],
      result: JSON.parse(JSON.stringify(result)),
    },
  });
  revalidatePath("/pools/simulator");
  redirect(`/pools/simulator/${row.id}`);
}

// Reexecuta com os catálogos/cenário atuais e re-grava o snapshot.
export async function rerunSimulation(formData: FormData): Promise<void> {
  const id = String(formData.get("simulationId") ?? "");
  if (!id) return;
  const sim = await prisma.poolSimulation.findUnique({ where: { id } });
  if (!sim) return;
  const input = await buildSimInput({
    fundingMode: sim.fundingMode,
    compMode: sim.compMode,
    perfPct: sim.perfPct,
    equityGatePct: sim.equityGatePct,
    parallelPermit: sim.parallelPermit,
    unitGapDays: sim.unitGapDays,
    scenarioCode: sim.scenarioCode,
    bankProfileId: sim.bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
  });
  if ("error" in input) return;
  const result = simulate(input);
  await prisma.poolSimulation.update({
    where: { id },
    data: { result: JSON.parse(JSON.stringify(result)) },
  });
  revalidatePath(`/pools/simulator/${id}`);
}

export async function deleteSimulation(formData: FormData): Promise<void> {
  const id = String(formData.get("simulationId") ?? "");
  if (id) await prisma.poolSimulation.delete({ where: { id } });
  revalidatePath("/pools/simulator");
  redirect("/pools/simulator");
}
