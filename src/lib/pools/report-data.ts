import { prisma } from "@/lib/db";
import { simulate, type SimInput } from "@/lib/pools/simulator";
import { buildSimInput, type PromoteTierInput, type SimOverrides, type UnitRef } from "@/lib/pools/build-sim-input";
import { assembleReportData, type ReportData, type ReportModelInfo } from "@/lib/pools/report-data-core";

// WRAPPER Prisma do report-data (15/07): busca simulação/cenários/modelos, roda os 3
// cenários frescos do catálogo e delega a MONTAGEM ao núcleo puro (report-data-core.ts),
// que é o que vai no pacote standalone da 4U junto com o motor. Tipos re-exportados.

export type { MonthlyRow, ReportData, ScenarioKpis, SensitivityRow } from "@/lib/pools/report-data-core";

export async function buildReportData(simulationId: string): Promise<ReportData | { error: string }> {
  const sim = await prisma.poolSimulation.findUnique({
    where: { id: simulationId },
    include: { scenario: true, bankProfile: true },
  });
  if (!sim) return { error: "Simulation not found." };

  const fieldsBase = {
    fundingMode: sim.fundingMode,
    upfrontFunding: sim.upfrontFunding,
    compMode: sim.compMode,
    perfPct: sim.perfPct,
    perfTiming: sim.perfTiming,
    promoteTiers: (sim.promoteTiers as PromoteTierInput[] | null) ?? null,
    flatFeePerHouse: sim.flatFeePerHouse,
    paymentPlan: sim.paymentPlan,
    equityGatePct: sim.equityGatePct,
    unitGapDays: sim.unitGapDays,
    bankProfileId: sim.bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
    overrides: (sim.overrides as SimOverrides | null) ?? null,
    vehicleStructure: sim.vehicleStructure,
  };

  const allScenarios = await prisma.bufferScenario.findMany({
    orderBy: { sortOrder: "asc" },
    select: { code: true, name: true },
  });

  const runs: Array<{ code: string; name: string; input: SimInput; result: ReturnType<typeof simulate> }> = [];
  for (const s of allScenarios) {
    const input = await buildSimInput({ ...fieldsBase, scenarioCode: s.code });
    if ("error" in input) return { error: `${s.name}: ${input.error}` };
    runs.push({ code: s.code, name: s.name, input, result: simulate(input) });
  }

  const models: ReportModelInfo[] = (
    await prisma.catalogModel.findMany({
      select: {
        id: true,
        name: true,
        sqft: true,
        photo: true,
        photoWidth: true,
        photoHeight: true,
        beds: true,
        baths: true,
        garageSpaces: true,
        builtSqft: true,
        tagline: true,
      },
    })
  ).map((m) => ({ ...m, baths: m.baths == null ? null : Number(m.baths) }));

  return assembleReportData(
    {
      name: sim.name,
      generatedAt: new Date().toISOString().slice(0, 10),
      fundingMode: sim.fundingMode,
      vehicleStructure: sim.vehicleStructure,
      clientEntityName: sim.clientEntityName ?? null,
      vehicleEntityName: sim.vehicleEntityName ?? null,
      compMode: sim.compMode,
      perfPct: Number(sim.perfPct ?? 0),
      perfTiming: sim.perfTiming,
      promoteTiers: (sim.promoteTiers as PromoteTierInput[] | null) ?? null,
      flatFeePerHouse: Number(sim.flatFeePerHouse ?? 0),
      bankName: sim.bankProfile?.name ?? null,
      bankTerms: sim.bankProfile
        ? {
            ltcBuildPct: Number(sim.bankProfile.ltcBuildPct),
            ltvPct: Number(sim.bankProfile.ltvPct),
            aprEffectivePct:
              sim.bankProfile.rateType === "FIXED"
                ? Number(sim.bankProfile.aprPct)
                : Number(sim.bankProfile.indexPct) + Number(sim.bankProfile.spreadPct),
            termMonths: sim.bankProfile.termMonths,
          }
        : null,
      bankTermMonths: sim.bankProfile?.termMonths ?? null,
      overrides: (sim.overrides as SimOverrides | null) ?? null,
      basketModelIds: [...new Set(((sim.units as UnitRef[]) ?? []).map((u) => u.modelId))],
    },
    runs,
    models,
  );
}
