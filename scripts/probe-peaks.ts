import { prisma } from "../src/lib/db";
import { simulate } from "../src/lib/pools/simulator";
import { buildSimInput, type PromoteTierInput, type SimOverrides, type UnitRef } from "../src/lib/pools/build-sim-input";

async function main() {
  const sim = await prisma.poolSimulation.findFirst({ where: { name: { contains: process.argv[2] || "PH7" } } });
  if (!sim) throw new Error("não achada");
  for (const code of ["OPT", "REAL", "CONS"]) {
    const input = await buildSimInput({
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
      scenarioCode: code,
      bankProfileId: sim.bankProfileId,
      units: (sim.units as UnitRef[]) ?? [],
      overrides: (sim.overrides as SimOverrides | null) ?? null,
      vehicleStructure: sim.vehicleStructure,
    });
    if ("error" in input) throw new Error(input.error);
    const r = simulate(input);
    const roi = r.kpis.peakCapital > 0 ? (r.kpis.profit / r.kpis.peakCapital) * 100 : 0;
    console.log(
      `${code}: pico $${Math.round(r.kpis.peakCapital).toLocaleString("en-US")} · ROI ${roi.toFixed(1)}% · lucro $${Math.round(r.kpis.profit).toLocaleString("en-US")} · TIR ${((r.kpis.irrAnnual ?? 0) * 100).toFixed(1)}% · ${Math.round(r.kpis.durationDays / 30 * 10) / 10}m`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
