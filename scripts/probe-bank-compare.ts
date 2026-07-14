/** Decompõe o custo de cada banco na comparação da PH-6 — juros vs fees vs estrutura. */
import { prisma } from "../src/lib/db";
import { simulate } from "../src/lib/pools/simulator";
import { buildSimInput, type PromoteTierInput, type SimOverrides, type UnitRef } from "../src/lib/pools/build-sim-input";

async function main() {
  const sim = await prisma.poolSimulation.findFirst({ where: { name: { contains: process.argv[2] || "PH-6" } } });
  if (!sim) throw new Error("não achada");
  const banks = await prisma.bankProfile.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  console.log(`${sim.name} [${sim.scenarioCode}] — decomposição por banco:`);
  for (const b of banks) {
    const input = await buildSimInput({
      fundingMode: "BANK",
      upfrontFunding: sim.upfrontFunding,
      compMode: sim.compMode,
      perfPct: sim.perfPct,
      perfTiming: sim.perfTiming,
      promoteTiers: (sim.promoteTiers as PromoteTierInput[] | null) ?? null,
      flatFeePerHouse: sim.flatFeePerHouse,
      paymentPlan: sim.paymentPlan,
      equityGatePct: sim.equityGatePct,
      unitGapDays: sim.unitGapDays,
      scenarioCode: sim.scenarioCode,
      bankProfileId: b.id,
      units: (sim.units as UnitRef[]) ?? [],
      overrides: (sim.overrides as SimOverrides | null) ?? null,
      vehicleStructure: sim.vehicleStructure,
    });
    if ("error" in input) {
      console.log(`  ${b.name}: ERRO ${input.error}`);
      continue;
    }
    const r = simulate(input);
    const k = r.kpis;
    const cost = k.bankUpfrontFees + k.bankInterestTotal + (k.bankOtherFees ?? 0) + k.bankExtensionFee;
    const f = (v: number) => Math.round(v).toLocaleString("en-US");
    console.log(
      `  ${b.name.padEnd(26)} TIR ${k.irrAnnual == null ? "—" : (k.irrAnnual * 100).toFixed(1) + "%"} · lucro $${f(k.profit)} · pico $${f(k.peakCapital)} · aportado $${f(k.totalInvested)}\n` +
        `    ${"".padEnd(26)} custo $${f(cost)} = closing $${f(k.bankUpfrontFees)} + juros $${f(k.bankInterestTotal)} + draw/payoff $${f(k.bankOtherFees ?? 0)} + ext $${f(k.bankExtensionFee)} · comprometido $${f(k.bankCommitted)} · reserve financiada $${f(k.bankReserveFunded)} · CTC $${f(k.cashToClosing)}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
