/** Debug: promote com PERFORMANCE — o waterfall dispara? */
import { simulate, type SimInput, type SimScenario, type SimUnitInput } from "../src/lib/pools/simulator";

const SC: SimScenario = {
  salePriceBufferPct: 0,
  constructionCostBufferPct: 0,
  lotCostBufferPct: 0,
  closingFeePct: 6,
  contingencyReservePct: 0,
  landAcquisitionDays: 15,
  saleClosingDays: 45,
  constructionDurationBufferM: 0,
  salesAbsorptionMonths: null,
  emdPct: 5,
};
const U: SimUnitInput = {
  label: "Casa A",
  locationName: "L1",
  modelName: "A",
  permitDays: 45,
  lotLeadDays: 10,
  saleDays: 60,
  buildMonths: 5,
  costPerformance: 200000,
  costContractor: 185000,
  costOpenBook: 190000,
  contractorFee: 25000,
  lotCost: 48000,
  salePrice: 310000,
  cycle: 1,
};
const input: SimInput = {
  fundingMode: "EQUITY",
  upfrontFunding: false,
  compMode: "PERFORMANCE",
  flatFeePerHouse: 0,
  perfPct: 0.35,
  perfTiming: "PROJECT_COMPLETION",
  promoteTiers: [
    { hurdlePct: 8, promotePct: 0 },
    { hurdlePct: null, promotePct: 30 },
  ],
  paymentPlan: "STANDARD",
  equityGatePct: 0.1,
  unitGapDays: 3,
  scenario: SC,
  bank: null,
  units: [U, U, U],
};
const r = simulate(input);
console.log("perfFee(4U):", r.kpis.perfFeeTotal, "· promote(Vixus):", r.kpis.promoteTotal, "· lucro:", r.kpis.profit, "· TIR:", r.kpis.irrAnnual);
console.log("eventos PERF_FEE:", r.events.filter((e) => e.kind === "PERF_FEE").map((e) => `${e.label} ${e.amount}`));
