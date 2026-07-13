import { prisma } from "../src/lib/db";
import { simulate } from "../src/lib/pools/simulator";
import { buildSimInput, type PromoteTierInput, type UnitRef } from "../src/lib/pools/build-sim-input";

async function main() {
  const target = process.argv[2] || "ESTEIRA";
  const sim = await prisma.poolSimulation.findFirst({ where: { name: { contains: target } } });
  if (!sim) throw new Error("não achada");
  console.log("compMode:", sim.compMode, "· promoteTiers:", JSON.stringify(sim.promoteTiers), "· flat:", String(sim.flatFeePerHouse));
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
    });
    if ("error" in input) throw new Error(input.error);
    const r = simulate(input);
    const vendas = r.units.reduce((s, u) => s + u.adjSaleNet, 0);
    const lotes = r.units.reduce((s, u) => s + u.adjLot, 0);
    const obra = r.units.reduce((s, u) => s + u.adjBuild, 0);
    const bankCost =
      r.kpis.bankUpfrontFees + r.kpis.bankInterestTotal + (r.kpis.bankOtherFees ?? 0) + r.kpis.bankExtensionFee;
    console.log(
      `${code}: vendas ${Math.round(vendas)} · lotes ${Math.round(lotes)} · obra ${Math.round(obra)} · banco ${Math.round(bankCost)} (juros ${Math.round(r.kpis.bankInterestTotal)}, ext ${Math.round(r.kpis.bankExtensionFee)}) · 4U ${Math.round(r.kpis.perfFeeTotal)} · promoteVixus ${Math.round(r.kpis.promoteTotal ?? 0)} · lucro ${Math.round(r.kpis.profit)} · TIR ${r.kpis.irrAnnual == null ? "—" : (r.kpis.irrAnnual * 100).toFixed(1) + "%"} · duração ${r.kpis.durationDays}d`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
