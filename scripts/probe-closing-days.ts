/**
 * Verifica a semântica nova dos closings (13/07/2026):
 *   tEmd = tReq + lotLeadDays · tLotClose = tEmd + landAcq(15) ·
 *   tPermitOk = tLotClose + permitDays · tCashIn = tCO + saleDays + absorção + saleClosing(45)
 * E imprime o A/B de KPIs das simulações reais.
 */
import { prisma } from "../src/lib/db";
import { simulate } from "../src/lib/pools/simulator";
import { buildSimInput, type PromoteTierInput, type UnitRef } from "../src/lib/pools/build-sim-input";

async function run(name: string) {
  const sim = await prisma.poolSimulation.findFirst({ where: { name: { contains: name } } });
  if (!sim) {
    console.log(`(${name} não encontrada)`);
    return;
  }
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
    scenarioCode: "CONS",
    bankProfileId: sim.bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
  });
  if ("error" in input) throw new Error(input.error);
  const r = simulate(input);
  const sc = input.scenario;

  let bad = 0;
  for (const u of r.units) {
    const absorption = Math.round((sc.salesAbsorptionMonths ?? 0) * 30);
    const checks: Array<[string, number, number]> = [
      ["tEmd", u.tEmd, u.tReq + u.lotLeadDays],
      ["tLotClose", u.tLotClose, u.tEmd + sc.landAcquisitionDays],
      ["tPermitOk", u.tPermitOk, u.tLotClose + u.permitDays],
      ["tCashIn", u.tCashIn, u.tCO + u.saleDays + absorption + sc.saleClosingDays],
    ];
    for (const [what, got, want] of checks)
      if (got !== want) {
        console.log(`  FAIL ${u.label}: ${what} = ${got}, esperado ${want}`);
        bad++;
      }
  }
  const emdEvents = r.events.filter((e) => e.label.includes("EMD"));
  const dayZeroEmd = emdEvents.filter((e) => e.day === 0).length;
  const u0 = r.units[0];
  console.log(`${sim.name} [CONS] — datas ${bad === 0 ? "OK" : `${bad} FALHAS`}`);
  console.log(
    `  casa 1 (${u0.label}): busca D+${u0.tReq} → caução D+${u0.tEmd} → closing lote D+${u0.tLotClose} → permit D+${u0.tPermitOk} → CO D+${u0.tCO} → caixa D+${u0.tCashIn}`,
  );
  console.log(`  EMDs em D+0: ${dayZeroEmd} (esperado 0)`);
  console.log(
    `  KPIs: TIR ${r.kpis.irrAnnual == null ? "—" : (r.kpis.irrAnnual * 100).toFixed(1) + "%"} · lucro $${Math.round(r.kpis.profit).toLocaleString("en-US")} · pico $${Math.round(r.kpis.peakCapital).toLocaleString("en-US")} · duração ${r.kpis.durationDays}d`,
  );
}

async function main() {
  await run("PH-6");
  await run("ESTEIRA");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
