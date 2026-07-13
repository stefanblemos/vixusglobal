/** Fases do projeto (lotes/permits/obra/vendas/loan) de uma simulação — p/ avaliar a feature. */
import { prisma } from "../src/lib/db";
import { simulate } from "../src/lib/pools/simulator";
import { buildSimInput, type PromoteTierInput, type SimOverrides, type UnitRef } from "../src/lib/pools/build-sim-input";

async function main() {
  const sim = await prisma.poolSimulation.findFirst({ where: { name: { contains: process.argv[2] || "PH-6" } } });
  if (!sim) throw new Error("não achada");
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
    scenarioCode: "CONS",
    bankProfileId: sim.bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
    overrides: (sim.overrides as SimOverrides | null) ?? null,
  });
  if ("error" in input) throw new Error(input.error);
  const r = simulate(input);
  const us = r.units;
  const m = (d: number) => (d / 30).toFixed(1);
  const span = (a: number, b: number) => `D+${a} → D+${b} (${m(b - a)}m)`;
  console.log(`${sim.name} [CONS, BANK] — duração total ${r.kpis.durationDays}d (${m(r.kpis.durationDays)}m)`);
  console.log(`  Lotes (busca→último closing):  ${span(Math.min(...us.map(u => u.tReq)), Math.max(...us.map(u => u.tLotClose)))}`);
  console.log(`  Permits:                       ${span(Math.min(...us.map(u => u.tLotClose)), Math.max(...us.map(u => u.tPermitOk)))}`);
  console.log(`  Obra:                          ${span(Math.min(...us.map(u => u.tBuildStart)), Math.max(...us.map(u => u.tCO)))}`);
  console.log(`  Vendas (CO→caixa):             ${span(Math.min(...us.map(u => u.tCO)), Math.max(...us.map(u => u.tCashIn)))}`);
  const bankEvents = r.events.filter(e => e.kind.startsWith("BANK") || (e.bankBalance ?? 0) > 0);
  const loanOpen = r.events.find(e => e.bankBalance > 0)?.day ?? 0;
  const loanClose = Math.max(...r.events.filter(e => e.bankBalance > 0).map(e => e.day), 0);
  console.log(`  Loan (1º saldo→zerar):         ${span(loanOpen, loanClose)}  ·  juros ${Math.round(r.kpis.bankInterestTotal)} · ext fee ${Math.round(r.kpis.bankExtensionFee)}`);
  console.log(`  (term do banco: ${input.bank?.termMonths}m a partir do closing do loan)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
