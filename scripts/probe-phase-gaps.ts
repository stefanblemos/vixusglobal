/** Mede os intervalos REAIS por fase (união dos períodos casa a casa) e os gaps — p/ avaliar
 *  se as barras de fases devem ser segmentadas em vez de min→max contínuo. */
import { prisma } from "../src/lib/db";
import { simulate } from "../src/lib/pools/simulator";
import { buildSimInput, type PromoteTierInput, type SimOverrides, type UnitRef } from "../src/lib/pools/build-sim-input";

function mergeIntervals(iv: Array<[number, number]>): Array<[number, number]> {
  const s = [...iv].sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

async function main() {
  const sim = await prisma.poolSimulation.findFirst({
    where: { name: { contains: process.argv[2] || "PH6" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!sim) throw new Error("não achada");
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
    scenarioCode: sim.scenarioCode,
    bankProfileId: sim.bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
    overrides: (sim.overrides as SimOverrides | null) ?? null,
  });
  if ("error" in input) throw new Error(input.error);
  const r = simulate(input);
  const cycles = [...new Set(r.units.map((u) => u.cycle))].sort((a, b) => a - b);
  console.log(`${sim.name} [${sim.scenarioCode}] — ${r.units.length} casas · ${cycles.length} ciclo(s)`);
  const m = (d: number) => (d / 30).toFixed(1);
  const phases: Array<[string, (u: (typeof r.units)[number]) => [number, number]]> = [
    ["Lotes", (u) => [u.tReq, u.tLotClose]],
    ["Permits", (u) => [u.tLotClose, u.tPermitOk]],
    ["Obra", (u) => [u.tBuildStart, u.tCO]],
    ["Vendas", (u) => [u.tCO, u.tCashIn]],
  ];
  for (const [label, f] of phases) {
    const merged = mergeIntervals(r.units.map(f));
    const span = [merged[0][0], merged[merged.length - 1][1]];
    const active = merged.reduce((s, [a, b]) => s + (b - a), 0);
    const gaps = merged.slice(1).map((seg, i) => [merged[i][1], seg[0]] as [number, number]);
    console.log(
      `  ${label.padEnd(8)} ponta a ponta ${m(span[1] - span[0])}m · ativo ${m(active)}m · ${merged.length} bloco(s)` +
        (gaps.length
          ? ` · GAPS: ${gaps.map(([a, b]) => `D+${a}→D+${b} (${m(b - a)}m)`).join(", ")}`
          : " · sem gaps"),
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
