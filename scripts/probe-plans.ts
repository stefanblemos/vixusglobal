/** Compara os 3 planos de desembolso na mesma simulação (CONS) — efeito no pico/TIR. */
import { prisma } from "../src/lib/db";
import { simulate } from "../src/lib/pools/simulator";
import { buildSimInput, type PromoteTierInput, type UnitRef } from "../src/lib/pools/build-sim-input";

async function main() {
  const sim = await prisma.poolSimulation.findFirst({ where: { name: { contains: process.argv[2] || "PH-6" } } });
  if (!sim) throw new Error("não achada");
  for (const plan of ["STANDARD", "LIGHT_START", "PARTNER"] as const) {
    const input = await buildSimInput({
      fundingMode: sim.fundingMode,
      upfrontFunding: sim.upfrontFunding,
      compMode: sim.compMode,
      perfPct: sim.perfPct,
      perfTiming: sim.perfTiming,
      promoteTiers: (sim.promoteTiers as PromoteTierInput[] | null) ?? null,
      flatFeePerHouse: sim.flatFeePerHouse,
      paymentPlan: plan,
      equityGatePct: sim.equityGatePct,
      unitGapDays: sim.unitGapDays,
      scenarioCode: "CONS",
      bankProfileId: sim.bankProfileId,
      units: (sim.units as UnitRef[]) ?? [],
    });
    if ("error" in input) throw new Error(input.error);
    const r = simulate(input);
    console.log(
      `${plan.padEnd(11)} pico $${Math.round(r.kpis.peakCapital).toLocaleString("en-US")} · TIR ${r.kpis.irrAnnual == null ? "—" : (r.kpis.irrAnnual * 100).toFixed(1) + "%"} · lucro $${Math.round(r.kpis.profit).toLocaleString("en-US")}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
