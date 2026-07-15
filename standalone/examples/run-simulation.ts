// Exemplo mínimo: monta o SimInput com buildSimInputCore (catálogo em JSON) e roda o motor.
// As premissas reais (cenários/fees/bancos/waterfall/custos de veículo) estão em
// data/premissas.json — locations/modelos vêm do SEU banco (a 4U já os tem).
import fs from "node:fs";
import path from "node:path";
import { buildSimInputCore, simulate, type CatalogData } from "../src/index";

const premissas = JSON.parse(
  fs.readFileSync(path.join(import.meta.dirname, "..", "data", "premissas.json"), "utf8"),
);

const scenario = premissas.scenarios.find((s: { code: string }) => s.code === "REAL");

// Combinação modelo×location de exemplo — na integração real, monte a partir do seu banco
const catalog: CatalogData = {
  scenario,
  combos: [
    {
      modelId: "m1",
      locationId: "l1",
      modelName: "Oakview Ranch",
      locationName: "Rainbow Lakes",
      houseType: "AFFORDABLE",
      buildMonths: 4,
      contractorFeeOverride: null,
      salePrice: 310000,
      costPerformance: 205000,
      costContractor: 190000,
      costOpenBook: 185000,
      permitDays: 45,
      lotLeadDays: 25,
      saleDays: 60,
      lotCostEstimate: 40000,
    },
  ],
  houseTypeFees: premissas.houseTypeFees,
  bank: null, // equity — para banco, use um perfil de premissas.banks
  vehicleCosts: premissas.vehicleCosts,
};

const input = buildSimInputCore(
  {
    fundingMode: "EQUITY",
    compMode: "CONTRACTOR_FEE",
    perfPct: 35,
    perfTiming: "PROJECT_COMPLETION",
    promoteTiers: premissas.waterfallTiers,
    flatFeePerHouse: 0,
    paymentPlan: "STANDARD",
    equityGatePct: 100,
    unitGapDays: scenario.unitGapDays,
    scenarioCode: "REAL",
    bankProfileId: null,
    units: [{ locationId: "l1", modelId: "m1" }],
    overrides: null,
    vehicleStructure: "VIXUS_MANAGED",
  },
  catalog,
);
if ("error" in input) throw new Error(input.error);

const r = simulate(input);
console.log("KPIs:", {
  irrAnnual: r.kpis.irrAnnual,
  profit: r.kpis.profit,
  peakCapital: r.kpis.peakCapital,
  durationDays: r.kpis.durationDays,
});
console.log(`Eventos no ledger: ${r.events.length}`);
