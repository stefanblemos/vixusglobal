import { prisma } from "@/lib/db";
import { simulate, type SimInput, type SimResult } from "@/lib/pools/simulator";
import {
  buildSimInput,
  countOverrides,
  type PromoteTierInput,
  type SimOverrides,
  type UnitRef,
} from "@/lib/pools/build-sim-input";
import marketStats from "@/data/market-stats.json";
import { phasesOf, type ProjectPhases } from "@/lib/pools/phases";
import { benchmarkOf, type BenchmarkRow } from "@/lib/pools/benchmark";

// Monta o pacote de dados do Investment Summary de UMA simulação: os 3 cenários rodados
// frescos do catálogo, sensibilidade/breakeven sobre o Expected Case (REAL — base operacional
// do report desde 15/07; a captação continua dimensionada pelo pico do Stress/CONS),
// fechamento ao centavo, ledger mensal agregado e a tabela de mercado do ATTOM.

export type ScenarioKpis = {
  code: string;
  name: string;
  irrAnnual: number | null;
  equityMultiple: number | null;
  peakCapital: number;
  profit: number;
  durationDays: number;
};

export type SensitivityRow = { label: string; irr: number | null; profit: number };

export type MonthlyRow = {
  month: number;
  calls: number;
  land: number;
  construction: number;
  bankNet: number;
  sales: number;
  distributions: number;
  endingCash: number;
};

export type ReportData = {
  simName: string;
  generatedAt: string; // ISO date
  fundingMode: "EQUITY" | "BANK";
  // estrutura do veículo: LLC da Vixus ou entidade própria do grupo (Vixus = Dev Manager)
  vehicleStructure: "VIXUS_MANAGED" | "CLIENT_ENTITY";
  clientEntityName: string | null;
  compMode: "CONTRACTOR_FEE" | "PERFORMANCE" | "PROMOTE" | "OPEN_BOOK";
  hasPromote: boolean; // promote/waterfall ativo (PROMOTE, ou OPEN_BOOK com tiers)
  promoteTiers: Array<{ hurdlePct: number | null; promotePct: number }> | null;
  flatFeePerHouse: number;
  compLabel: string;
  bankName: string | null;
  scenarios: ScenarioKpis[];
  base: SimResult; // Expected Case (REAL) — base operacional do report
  baseCode: string;
  cycles: Array<{ cycle: number; homes: number }>;
  // pico de capital se TODAS as casas fossem tocadas juntas (ciclo único) — mede a
  // eficiência de capital da esteira; null quando a simulação já é de ciclo único
  singleShotPeak: number | null;
  locations: string[];
  bankTerms: {
    ltcBuildPct: number;
    ltvPct: number;
    aprEffectivePct: number;
    termMonths: number;
  } | null;
  sensitivity: SensitivityRow[];
  breakevenPriceDropPct: number | null; // queda de preço de venda que zera o lucro
  closing: {
    sales: number;
    lots: number;
    construction: number;
    bankCost: number;
    builderComp: number; // 4U (performance/legado)
    promote: number; // Vixus (developer waterfall)
    vehicle: number; // custos do veículo (abertura/contador/annual report/encerramento)
    contractorFeeTotal: number;
    result: number;
    diff: number; // vs kpis.profit — tem que ser 0.00
  };
  monthly: MonthlyRow[];
  market: typeof marketStats;
  // nº de premissas ajustadas na aba Premissas (0 = tudo do catálogo) — nota no A.1
  customAssumptions: number;
  // fases do projeto (base case) + janela real do loan — tabela na seção 5
  projectPhases: ProjectPhases;
  // premissas × vendidos no submarket (ATTOM) — tabela no §3 + grounding da IA
  benchmark: BenchmarkRow[];
};

const round2 = (v: number) => Math.round(v * 100) / 100;

function closingOf(r: SimResult) {
  const sales = r.units.reduce((s, u) => s + u.adjSaleNet, 0);
  const lots = r.units.reduce((s, u) => s + u.adjLot, 0);
  const construction = r.units.reduce((s, u) => s + u.adjBuild, 0);
  const bankCost =
    r.kpis.bankUpfrontFees +
    r.kpis.bankInterestTotal +
    (r.kpis.bankOtherFees ?? 0) +
    r.kpis.bankExtensionFee;
  const builderComp = r.kpis.perfFeeTotal;
  const promote = r.kpis.promoteTotal ?? 0; // snapshot antigo: promote embutido no perf
  const vehicle = r.kpis.vehicleCostTotal ?? 0;
  const result = round2(sales - lots - construction - bankCost - builderComp - promote - vehicle);
  return {
    sales: round2(sales),
    lots: round2(lots),
    construction: round2(construction),
    bankCost: round2(bankCost),
    builderComp: round2(builderComp),
    promote: round2(promote),
    vehicle: round2(vehicle),
    contractorFeeTotal: round2(r.kpis.contractorFeeTotal),
    result,
    diff: round2(result - r.kpis.profit),
  };
}

// Ledger mensal agregado por natureza (mês = floor(day/30)+1, igual ao motor)
function monthlyOf(r: SimResult): MonthlyRow[] {
  const map = new Map<number, MonthlyRow>();
  for (const e of r.events) {
    const m = Math.floor(e.day / 30) + 1;
    const row =
      map.get(m) ??
      ({ month: m, calls: 0, land: 0, construction: 0, bankNet: 0, sales: 0, distributions: 0, endingCash: 0 } as MonthlyRow);
    switch (e.kind) {
      case "INJECTION":
        row.calls += e.amount;
        break;
      case "RETURN":
        row.distributions += -e.amount;
        break;
      case "LOT":
        row.land += -e.amount;
        break;
      case "PHASE":
      case "CONTINGENCY":
      case "PERF_FEE":
      case "VEHICLE":
        row.construction += -e.amount;
        break;
      case "SALE":
        row.sales += e.amount;
        break;
      default:
        // BANK_*: draws entram +, fees/juros/payoff saem − → efeito líquido no caixa
        row.bankNet += e.amount;
    }
    row.endingCash = e.cash; // eventos vêm ordenados — o último do mês fica
    map.set(m, row);
  }
  return [...map.values()]
    .sort((a, b) => a.month - b.month)
    .map((r0) => ({
      ...r0,
      calls: round2(r0.calls),
      land: round2(r0.land),
      construction: round2(r0.construction),
      bankNet: round2(r0.bankNet),
      sales: round2(r0.sales),
      distributions: round2(r0.distributions),
      endingCash: round2(r0.endingCash),
    }));
}

// Variações da sensibilidade aplicadas sobre o SimInput pronto (motor é função pura)
function withPrice(input: SimInput, mult: number): SimInput {
  return { ...input, units: input.units.map((u) => ({ ...u, salePrice: u.salePrice * mult })) };
}
function withCost(input: SimInput, mult: number): SimInput {
  return {
    ...input,
    units: input.units.map((u) => ({
      ...u,
      costPerformance: u.costPerformance * mult,
      costContractor: u.costContractor * mult,
      costOpenBook: u.costOpenBook * mult,
    })),
  };
}
function withDuration(input: SimInput, deltaMonths: number): SimInput {
  return {
    ...input,
    scenario: {
      ...input.scenario,
      constructionDurationBufferM: Math.max(
        0,
        input.scenario.constructionDurationBufferM + deltaMonths,
      ),
    },
  };
}

export async function buildReportData(simulationId: string): Promise<ReportData | { error: string }> {
  const sim = await prisma.poolSimulation.findUnique({
    where: { id: simulationId },
    include: { scenario: true, bankProfile: true },
  });
  if (!sim) return { error: "Simulation not found." };

  const fieldsBase = {
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
    bankProfileId: sim.bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
    overrides: (sim.overrides as SimOverrides | null) ?? null,
    vehicleStructure: sim.vehicleStructure,
  };

  const allScenarios = await prisma.bufferScenario.findMany({
    orderBy: { sortOrder: "asc" },
    select: { code: true, name: true },
  });

  const scenarios: ScenarioKpis[] = [];
  let realInput: SimInput | null = null;
  let realResult: SimResult | null = null;
  for (const s of allScenarios) {
    const input = await buildSimInput({ ...fieldsBase, scenarioCode: s.code });
    if ("error" in input) return { error: `${s.name}: ${input.error}` };
    const res = simulate(input);
    scenarios.push({
      code: s.code,
      name: s.name,
      irrAnnual: res.kpis.irrAnnual,
      equityMultiple: res.kpis.equityMultiple,
      peakCapital: res.kpis.peakCapital,
      profit: res.kpis.profit,
      durationDays: res.kpis.durationDays,
    });
    if (s.code === "REAL") {
      realInput = input;
      realResult = res;
    }
  }
  if (!realInput || !realResult) return { error: "Expected scenario (REAL) not found." };

  // Sensibilidade sobre o Expected Case (padrão de mercado: estressa-se o caso-base declarado)
  const sens: SensitivityRow[] = [
    { label: "Sale price −5%", input: withPrice(realInput, 0.95) },
    { label: "Sale price +5%", input: withPrice(realInput, 1.05) },
    { label: "Construction cost +5%", input: withCost(realInput, 1.05) },
    { label: "Construction cost −5%", input: withCost(realInput, 0.95) },
    { label: "Timeline +2 months", input: withDuration(realInput, 2) },
    { label: "Timeline −2 months", input: withDuration(realInput, -2) },
  ].map(({ label, input }) => {
    const r = simulate(input);
    return { label, irr: r.kpis.irrAnnual, profit: r.kpis.profit };
  });

  // Breakeven: maior queda de preço em que o lucro ainda é ≥ 0 (bisseção, 0–60%)
  let breakeven: number | null = null;
  if (realResult.kpis.profit > 0) {
    let lo = 0;
    let hi = 0.6;
    if (simulate(withPrice(realInput, 1 - hi)).kpis.profit > 0) {
      breakeven = null; // nem −60% zera — reportar como ">60%" no doc
    } else {
      for (let i = 0; i < 24; i++) {
        const mid = (lo + hi) / 2;
        if (simulate(withPrice(realInput, 1 - mid)).kpis.profit >= 0) lo = mid;
        else hi = mid;
      }
      breakeven = Math.round(lo * 1000) / 10; // % com 1 casa
    }
  }

  const cyclesMap = new Map<number, number>();
  for (const u of realResult.units) cyclesMap.set(u.cycle ?? 1, (cyclesMap.get(u.cycle ?? 1) ?? 0) + 1);
  const cycles = [...cyclesMap.entries()].sort((a, b) => a[0] - b[0]).map(([cycle, homes]) => ({ cycle, homes }));

  const singleShotPeak =
    cycles.length > 1
      ? simulate({ ...realInput, units: realInput.units.map((u) => ({ ...u, cycle: 1 })) }).kpis.peakCapital
      : null;

  const compLabel =
    sim.compMode === "PERFORMANCE"
      ? `Performance — ${Number(sim.perfPct)}% of net project profit, payable ${sim.perfTiming === "PER_SALE" ? "per sale" : "at project completion"}, before investor split`
      : sim.compMode === "PROMOTE"
        ? "Promote — tiered share of profit above investor return hurdles (waterfall), payable at completion"
        : sim.compMode === "OPEN_BOOK"
          ? `Open book — actual construction cost plus a flat fee of $${Number(sim.flatFeePerHouse).toLocaleString("en-US")} per home${(sim.promoteTiers as unknown[] | null)?.length ? ", plus a promote above investor return hurdles" : ""}`
          : "Contractor fee — fixed fee per home embedded in the construction contract";

  return {
    simName: sim.name,
    generatedAt: new Date().toISOString().slice(0, 10),
    fundingMode: sim.fundingMode as "EQUITY" | "BANK",
    vehicleStructure: sim.vehicleStructure as "VIXUS_MANAGED" | "CLIENT_ENTITY",
    clientEntityName: sim.clientEntityName ?? null,
    compMode: sim.compMode as "CONTRACTOR_FEE" | "PERFORMANCE" | "PROMOTE" | "OPEN_BOOK",
    // waterfall da Vixus: opt-in em QUALQUER modalidade (14/07) — basta ter tiers
    hasPromote:
      sim.compMode === "PROMOTE" || !!(sim.promoteTiers as unknown[] | null)?.length,
    promoteTiers: (sim.promoteTiers as Array<{ hurdlePct: number | null; promotePct: number }> | null) ?? null,
    flatFeePerHouse: Number(sim.flatFeePerHouse ?? 0),
    compLabel,
    bankName: sim.bankProfile?.name ?? null,
    scenarios,
    base: realResult,
    baseCode: "REAL",
    cycles,
    singleShotPeak,
    locations: [...new Set(realResult.units.map((u) => u.locationName))],
    bankTerms: sim.bankProfile
      ? {
          ltcBuildPct: Number(sim.bankProfile.ltcBuildPct),
          ltvPct: Number(sim.bankProfile.ltvPct),
          aprEffectivePct:
            sim.bankProfile.rateType === "FIXED"
              ? Number(sim.bankProfile.aprPct)
              : Number(sim.bankProfile.indexPct) + Number(sim.bankProfile.spreadPct),
          termMonths: sim.bankProfile.termMonths,
        }
      : null,
    sensitivity: sens,
    breakevenPriceDropPct: breakeven,
    closing: closingOf(realResult),
    monthly: monthlyOf(realResult),
    market: marketStats,
    customAssumptions: countOverrides((sim.overrides as SimOverrides | null) ?? null),
    projectPhases: phasesOf(realResult, sim.bankProfile?.termMonths ?? null),
    benchmark: benchmarkOf(
      realResult.units,
      new Map((await prisma.catalogModel.findMany({ select: { name: true, sqft: true } })).map((m) => [m.name, m.sqft])),
    ).rows,
  };
}
