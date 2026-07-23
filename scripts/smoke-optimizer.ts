// Smoke test do otimizador contra o espelho de produção.
//   DATABASE_URL="<prodcopy>" npx tsx scripts/smoke-optimizer.ts
import { prisma } from "../src/lib/db";
import { buildCatalogForLocations } from "../src/lib/pools/build-sim-input";
import { optimizeProgram, type OptimizerSettings } from "../src/lib/pools/optimizer";

const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;

async function main() {
  const locations = await prisma.catalogLocation.findMany({
    select: { id: true, name: true, absorptionPerYear: true },
    orderBy: { name: "asc" },
  });
  const bank = await prisma.bankProfile.findFirst({ orderBy: { name: "asc" }, select: { id: true, name: true } });
  const scenario = await prisma.bufferScenario.findFirst({ where: { code: "REAL" } });
  console.log("Bank:", bank?.name, "| Scenario:", scenario?.code);
  console.log("Locations:", locations.map((l) => `${l.name}(abs=${l.absorptionPerYear ?? "ATTOM/—"})`).join(", "));

  const locationIds = locations.map((l) => l.id);
  const base: Omit<OptimizerSettings, "fundingMode"> = {
    bankProfileId: bank?.id ?? null, scenarioCode: "REAL",
    compMode: "PERFORMANCE", perfPct: 35, perfTiming: "PROJECT_COMPLETION", promoteTiers: null,
    paymentPlan: "STANDARD", equityGatePct: 10, unitGapDays: 3, flatFeePerHouse: 0,
    vehicleStructure: "VIXUS_MANAGED", waiveFormationCost: false,
  };
  const catalog = await buildCatalogForLocations(locationIds, "REAL", bank?.id ?? null);
  if ("error" in catalog) { console.error("catalog error:", catalog.error); return; }

  const absorptionByLocation: Record<string, number | null> = {};
  for (const l of locations) absorptionByLocation[l.id] = l.absorptionPerYear;

  const runs: Array<{ target: number; mode: "EQUITY" | "BANK"; div: "CONCENTRATE" | "BALANCE" | "SPREAD" }> = [
    { target: 5_000_000, mode: "EQUITY", div: "CONCENTRATE" },
    { target: 5_000_000, mode: "EQUITY", div: "BALANCE" },
    { target: 5_000_000, mode: "EQUITY", div: "SPREAD" },
    { target: 5_000_000, mode: "BANK", div: "BALANCE" },
  ];
  for (const { target, mode, div } of runs) {
    const settings: OptimizerSettings = { ...base, fundingMode: mode };
    const t0 = Date.now();
    const r = optimizeProgram(catalog, {
      equityTarget: target, horizonMonths: 30, locationIds, sharePct: 8, diversity: div, absorptionByLocation, settings,
    });
    console.log(`\n===== ALVO ${money(target)} / 30m · ${mode} · ${div} (${Date.now() - t0}ms) =====`);
    console.log(`pico equity ${money(r.peak)} (${((r.peak / target) * 100).toFixed(0)}% do alvo) · banco ${money(r.bankCommitted)} · ocioso ${money(r.idleEquity)}`);
    console.log(`TIR ${r.kpis.irrAnnual != null ? (r.kpis.irrAnnual * 100).toFixed(1) + "%" : "n/s"} · lucro ${money(r.kpis.profit)} · prazo ${r.durationMonths}m · casas ${r.units.length}`);
    console.log("Cesta (ciclo 1 concorrente):");
    for (const l of r.lines) console.log(`  ${l.locationName} · ${l.modelName} ×${l.cycle1}${l.over ? " ⚠acima abs" : ""} (cap ${l.cap ?? "—"}/${l.source}, eq ${money(l.eqUnit)})`);
    console.log("Ciclos:", r.cycles.map((c) => `C${c.cycle}:${c.houses}`).join(" "));
    if (r.warnings.length) console.log("Avisos:", r.warnings.join(" | "));
  }
  await prisma.$disconnect();
}
main();
