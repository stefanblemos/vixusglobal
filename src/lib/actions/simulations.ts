"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { simulate, type SimInput, type SimUnitInput } from "@/lib/pools/simulator";
import type { BuilderCompMode, SimFundingMode } from "@prisma/client";

export type FormState = { error?: string } | undefined;

type UnitRef = { locationId: string; modelId: string };

type PromoteTierInput = { hurdlePct: number | null; promotePct: number };

function parsePromoteTiers(raw: string): PromoteTierInput[] | null {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const tiers = arr
      .map((t) => ({
        hurdlePct: t.hurdlePct == null || t.hurdlePct === "" ? null : Number(t.hurdlePct),
        promotePct: Number(t.promotePct),
      }))
      .filter((t) => Number.isFinite(t.promotePct) && (t.hurdlePct == null || Number.isFinite(t.hurdlePct)));
    return tiers.length > 0 ? tiers : null;
  } catch {
    return null;
  }
}

// Monta o SimInput a partir dos catálogos atuais (valores sempre frescos do banco).
async function buildSimInput(sim: {
  fundingMode: string;
  compMode: string;
  perfPct: unknown;
  perfTiming: string;
  promoteTiers: PromoteTierInput[] | null;
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
    const perfMode = sim.compMode !== "CONTRACTOR_FEE"; // performance e promote = custo direto
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
    compMode: sim.compMode as "CONTRACTOR_FEE" | "PERFORMANCE" | "PROMOTE",
    perfPct: Number(sim.perfPct) / 100,
    perfTiming: sim.perfTiming === "PER_SALE" ? "PER_SALE" : "PROJECT_COMPLETION",
    promoteTiers: sim.promoteTiers,
    paymentPlan: sim.paymentPlan === "LIGHT_START" ? "LIGHT_START" : "STANDARD",
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
    perfTiming: String(formData.get("perfTiming") ?? "PROJECT_COMPLETION"),
    promoteTiers: parsePromoteTiers(String(formData.get("promoteTiers") ?? "")),
    paymentPlan: String(formData.get("paymentPlan") ?? "STANDARD"),
    equityGatePct: Number(formData.get("equityGatePct") ?? 10),
    parallelPermit: formData.get("parallelPermit") === "on",
    unitGapDays: Number(formData.get("unitGapDays") ?? 3) || 3,
    scenarioCode: String(formData.get("scenarioCode") ?? "REAL"),
    bankProfileId: String(formData.get("bankProfileId") ?? "").trim() || null,
    poolId: String(formData.get("poolId") ?? "").trim() || null,
    units,
  };
  if (sim.compMode === "PROMOTE" && !sim.promoteTiers)
    return { error: "Defina pelo menos um tier do promote." };
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
      perfTiming: sim.perfTiming,
      promoteTiers: sim.promoteTiers ?? undefined,
      paymentPlan: sim.paymentPlan as "STANDARD" | "LIGHT_START",
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
    perfTiming: sim.perfTiming,
    promoteTiers: (sim.promoteTiers as PromoteTierInput[] | null) ?? null,
    paymentPlan: sim.paymentPlan,
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

// Converte a simulação aprovada num pool real: casas nascem com o pro forma do CENÁRIO
// (lote/obra/venda/closing ajustados), profit share e meta herdados; se for loan, o
// PoolLoan já nasce com o banco e o comprometido estimado. Daí é ajuste sobre o simulado.
export async function convertSimulationToPool(formData: FormData): Promise<void> {
  const id = String(formData.get("simulationId") ?? "");
  if (!id) return;
  const sim = await prisma.poolSimulation.findUnique({
    where: { id },
    include: { scenario: true, bankProfile: true },
  });
  if (!sim || sim.poolId) return; // inexistente ou já convertida
  const result = sim.result as {
    kpis?: { totalInvested?: number; bankCommitted?: number };
    units?: Array<{ label: string; salePrice: number; adjLot: number; adjBuild: number; adjSaleNet: number }>;
  } | null;
  if (!result?.units?.length) return; // rode a simulação antes

  const count = await prisma.investmentPool.count();
  const { roman } = await import("@/lib/pools/math");
  const code = `VHP-${roman(count + 1)}`;

  const saleBuffer = Number(sim.scenario.salePriceBufferPct) / 100;
  const round2 = (v: number) => Math.round(v * 100) / 100;

  const pool = await prisma.investmentPool.create({
    data: {
      code,
      name: `Vixus Home Partners ${roman(count + 1)} LLC`,
      alias: sim.name,
      status: "FUNDING",
      targetAmount: result.kpis?.totalInvested ?? null,
      profitSharePct: sim.compMode === "PERFORMANCE" ? Number(sim.perfPct) / 100 : null,
      profitShareTiming: sim.compMode === "PERFORMANCE" ? "PROJECT_COMPLETION" : null,
      notes: `Criado da simulação "${sim.name}" (cenário ${sim.scenario.name}, ${sim.fundingMode === "BANK" ? `loan ${sim.bankProfile?.name ?? ""}` : "equity"}).`,
      houses: {
        create: result.units.map((u, i) => {
          const gross = round2(u.salePrice * (1 + saleBuffer));
          const unitRef = (sim.units as Array<{ locationId?: string; modelId?: string }>)[i];
          return {
            address: `Casa ${i + 1} — ${u.label} (endereço a definir)`,
            status: "PLANNED" as const,
            // modelo/localização de origem: a casa carrega o vínculo do simulador
            catalogModelId: unitRef?.modelId ?? null,
            catalogLocationId: unitRef?.locationId ?? null,
            plannedLotCost: u.adjLot,
            plannedBuildCost: u.adjBuild,
            plannedSalePrice: gross,
            plannedClosingCost: round2(gross - u.adjSaleNet),
            notes: `Pro forma do cenário ${sim.scenario.name}`,
          };
        }),
      },
    },
  });

  await prisma.poolSimulation.update({ where: { id }, data: { poolId: pool.id } });

  if (sim.fundingMode === "BANK" && sim.bankProfileId) {
    await prisma.poolLoan.create({
      data: {
        poolId: pool.id,
        bankProfileId: sim.bankProfileId,
        committed: result.kpis?.bankCommitted ?? null,
        notes: `Estimado pela simulação "${sim.name}" — substituir pelo loan real no closing.`,
      },
    });
  }

  revalidatePath("/pools");
  redirect(`/pools/${pool.id}`);
}

export async function deleteSimulation(formData: FormData): Promise<void> {
  const id = String(formData.get("simulationId") ?? "");
  if (id) await prisma.poolSimulation.delete({ where: { id } });
  revalidatePath("/pools/simulator");
  redirect("/pools/simulator");
}
