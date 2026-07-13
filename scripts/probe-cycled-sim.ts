/**
 * Cria (se não existir) uma simulação EQUITY com ciclos a partir da cesta da PH-6 —
 * só para testar o Investment Summary com esteira. Base local; o sync de produção apaga.
 */
import { prisma } from "../src/lib/db";

async function main() {
  const existing = await prisma.poolSimulation.findFirst({ where: { name: "TESTE-ESTEIRA (temp)" } });
  if (existing) {
    console.log("já existe:", existing.id);
    return;
  }
  const src = await prisma.poolSimulation.findFirst({ where: { name: "PH-6" } });
  if (!src) throw new Error("PH-6 não achada");
  const base = src.units as Array<{ locationId: string; modelId: string }>;
  const units = [
    ...base.slice(0, 3).map((u) => ({ ...u, cycle: 1 })),
    ...base.slice(0, 4).map((u) => ({ ...u, cycle: 2 })),
    ...base.map((u) => ({ ...u, cycle: 3 })),
  ];
  const sim = await prisma.poolSimulation.create({
    data: {
      name: "TESTE-ESTEIRA (temp)",
      fundingMode: "EQUITY",
      upfrontFunding: false,
      compMode: src.compMode,
      perfPct: src.perfPct,
      perfTiming: src.perfTiming,
      promoteTiers: src.promoteTiers ?? undefined,
      flatFeePerHouse: src.flatFeePerHouse,
      paymentPlan: src.paymentPlan,
      equityGatePct: src.equityGatePct,
      parallelPermit: src.parallelPermit,
      unitGapDays: src.unitGapDays,
      scenarioCode: src.scenarioCode,
      bankProfileId: null,
      units,
    },
  });
  console.log("criada:", sim.id, "-", units.length, "casas em 3 ciclos (3/4/5)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
