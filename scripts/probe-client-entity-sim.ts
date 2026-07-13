/** Cria sim de teste: PERFORMANCE + waterfall da Vixus + CLIENT_ENTITY (base local). */
import { prisma } from "../src/lib/db";

async function main() {
  const existing = await prisma.poolSimulation.findFirst({ where: { name: "TESTE-CLIENTE (temp)" } });
  if (existing) {
    console.log("já existe:", existing.id);
    return;
  }
  const src = await prisma.poolSimulation.findFirst({ where: { name: "PH-6" } });
  if (!src) throw new Error("PH-6 não achada");
  const sim = await prisma.poolSimulation.create({
    data: {
      name: "TESTE-CLIENTE (temp)",
      fundingMode: "EQUITY",
      compMode: "PERFORMANCE",
      perfPct: 35,
      perfTiming: "PROJECT_COMPLETION",
      promoteTiers: [
        { hurdlePct: 8, promotePct: 0 },
        { hurdlePct: null, promotePct: 30 },
      ],
      flatFeePerHouse: 0,
      paymentPlan: "PARTNER",
      upfrontFunding: false,
      equityGatePct: src.equityGatePct,
      unitGapDays: src.unitGapDays,
      scenarioCode: "REAL",
      bankProfileId: null,
      vehicleStructure: "CLIENT_ENTITY",
      clientEntityName: "Falcon Family Holdings LLC",
      units: src.units as object[],
    },
  });
  console.log("criada:", sim.id);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
