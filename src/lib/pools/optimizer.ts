import { simulate, type SimResult } from "@/lib/pools/simulator";
import {
  buildSimInputCore,
  type CatalogData,
  type PromoteTierInput,
  type SimFields,
  type UnitRef,
} from "@/lib/pools/build-input-core";
import {
  absorptionForLocation,
  capConcurrent,
  DEFAULT_MARKET_SHARE_PCT,
  type AbsorptionSource,
} from "@/lib/pools/absorption";

/**
 * OTIMIZADOR DE PROGRAMA ("montar pelo alvo") — camada NOVA por cima do motor.
 *
 * NÃO recalcula economia própria: monta cestas candidatas e chama o MOTOR (simulate) para
 * medir cada uma (pico de equity, TIR, datas REAIS). Decisões do Stefan (jul/2026):
 *  - o $ do alvo é EQUITY (dinheiro do grupo); o banco financia a obra e entra alavancado;
 *  - o alvo TEM que ser gasto — absorção vira aviso, não muro (espalha o excesso — resp. 1a);
 *  - objetivo = TIR; horizonte = meta com folga (pode passar um pouco — resp. 2);
 *  - modelos elegíveis = os do local; ATTOM manda na absorção, senão o manual do Catalog.
 *
 * A esteira do motor é 1:1 (uma venda financia a próxima casa) → ondas estáveis. O PICO é
 * fixado pela concorrência do ciclo 1; os ciclos seguintes mantêm o capital girando ao
 * longo do horizonte. Por isso a busca calibra as contagens do ciclo 1 contra o
 * peakCapital do motor até bater o equity-alvo, e escolhe K ciclos para preencher o prazo.
 */

export type OptimizerSettings = {
  fundingMode: "EQUITY" | "BANK";
  bankProfileId: string | null;
  scenarioCode: string;
  compMode: string;
  perfPct: number; // % (ex.: 35) — o core divide por 100
  perfTiming: string;
  promoteTiers: PromoteTierInput[] | null;
  paymentPlan: string;
  equityGatePct: number;
  unitGapDays: number;
  flatFeePerHouse: number;
  vehicleStructure: string;
  waiveFormationCost: boolean;
};

export type OptimizerInput = {
  equityTarget: number;
  horizonMonths: number;
  locationIds: string[];
  sharePct?: number; // participação de mercado tolerada do mesmo modelo (default 8%)
  absorptionByLocation: Record<string, number | null>; // manual do Catalog por locationId
  settings: OptimizerSettings;
};

export type ComboEcon = {
  locationId: string;
  modelId: string;
  locationName: string;
  modelName: string;
  eqUnit: number; // pico de equity de 1 unidade (medido pelo motor)
  bankUnit: number; // comprometido do banco p/ 1 unidade
  profitUnit: number;
  cycleDays: number; // tCashIn de 1 unidade
  effic: number; // profitUnit / (eqUnit × anos) — eficiência de capital
  perYear: number | null;
  source: AbsorptionSource;
  cap: number | null; // cap concorrente por ciclo (null = sem dado)
};

export type BasketLine = {
  locationId: string;
  modelId: string;
  locationName: string;
  modelName: string;
  cycle1: number; // casas concorrentes por onda
  cycles: number; // K ondas
  over: boolean; // acima da absorção
  cap: number | null;
  source: AbsorptionSource;
  perYear: number | null;
  eqUnit: number;
  bankUnit: number;
  profitUnit: number;
  cycleDays: number;
};

export type CycleBreakdown = {
  cycle: number;
  houses: number;
  equityWave: number;
  items: Array<{ locationName: string; modelName: string; qty: number; over: boolean }>;
};

export type ProgramKpis = SimResult["kpis"];

export type ProgramEval = {
  kpis: ProgramKpis;
  peak: number;
  bankCommitted: number;
  durationMonths: number;
  cycles: CycleBreakdown[];
  error?: string;
};

export type OptimizerResult = ProgramEval & {
  lines: BasketLine[];
  econ: ComboEcon[]; // TODOS os combos elegíveis sondados (p/ trocar modelo no modal)
  units: UnitRef[];
  idleEquity: number; // max(0, alvo − pico)
  overSpend: number; // max(0, pico − alvo)
  warnings: string[];
};

// ── helpers ────────────────────────────────────────────────────────────────
function buildFields(s: OptimizerSettings, units: UnitRef[]): SimFields {
  return {
    fundingMode: s.fundingMode,
    upfrontFunding: false,
    compMode: s.compMode,
    perfPct: s.perfPct,
    perfTiming: s.perfTiming,
    promoteTiers: s.promoteTiers,
    flatFeePerHouse: s.flatFeePerHouse,
    paymentPlan: s.paymentPlan,
    equityGatePct: s.equityGatePct,
    unitGapDays: s.unitGapDays,
    scenarioCode: s.scenarioCode,
    bankProfileId: s.bankProfileId,
    units,
    overrides: null,
    vehicleStructure: s.vehicleStructure,
    waiveFormationCost: s.waiveFormationCost,
  };
}

function runSim(catalog: CatalogData, s: OptimizerSettings, units: UnitRef[]): SimResult | { error: string } {
  const input = buildSimInputCore(buildFields(s, units), catalog);
  if ("error" in input) return input;
  return simulate(input);
}

// UnitRefs de uma cesta: por linha, cycle1 casas em cada uma das K ondas.
function linesToUnits(lines: BasketLine[]): UnitRef[] {
  const units: UnitRef[] = [];
  for (const l of lines) {
    if (l.cycle1 <= 0) continue;
    for (let c = 1; c <= l.cycles; c++) {
      for (let i = 0; i < l.cycle1; i++) {
        units.push({ locationId: l.locationId, modelId: l.modelId, cycle: c });
      }
    }
  }
  return units;
}

const median = (a: number[]) => {
  if (a.length === 0) return 255;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

// Sonda a economia de 1 unidade pelo motor real — base do ranking por eficiência.
function probeCombo(
  catalog: CatalogData,
  input: OptimizerInput,
  combo: CatalogData["combos"][number],
): ComboEcon | null {
  const r = runSim(catalog, input.settings, [
    { locationId: combo.locationId, modelId: combo.modelId, cycle: 1 },
  ]);
  if ("error" in r) return null;
  const eqUnit = r.kpis.peakCapital;
  if (!(eqUnit > 0)) return null;
  const cycleDays = r.units[0]?.tCashIn ?? 255;
  const years = Math.max(cycleDays, 1) / 365;
  const abs = absorptionForLocation(combo.locationName, input.absorptionByLocation[combo.locationId]);
  const sharePct = input.sharePct ?? DEFAULT_MARKET_SHARE_PCT;
  return {
    locationId: combo.locationId,
    modelId: combo.modelId,
    locationName: combo.locationName,
    modelName: combo.modelName,
    eqUnit,
    bankUnit: r.kpis.bankCommitted,
    profitUnit: r.kpis.profit,
    cycleDays,
    effic: r.kpis.profit / (eqUnit * years),
    perYear: abs.perYear,
    source: abs.source,
    cap: capConcurrent(abs.perYear, cycleDays, sharePct),
  };
}

function cyclesBreakdown(lines: BasketLine[]): CycleBreakdown[] {
  const K = Math.max(1, ...lines.map((l) => l.cycles));
  const out: CycleBreakdown[] = [];
  for (let c = 1; c <= K; c++) {
    const items = lines
      .filter((l) => l.cycle1 > 0 && l.cycles >= c)
      .map((l) => ({ locationName: l.locationName, modelName: l.modelName, qty: l.cycle1, over: l.over }));
    out.push({
      cycle: c,
      houses: items.reduce((s, i) => s + i.qty, 0),
      equityWave: lines.filter((l) => l.cycles >= c).reduce((s, l) => s + l.cycle1 * l.eqUnit, 0),
      items,
    });
  }
  return out;
}

// ── avaliação de uma cesta pronta (usada no otimizador E no recálculo ao vivo) ──
export function evaluateProgram(
  catalog: CatalogData,
  settings: OptimizerSettings,
  lines: BasketLine[],
): ProgramEval {
  const units = linesToUnits(lines);
  if (units.length === 0)
    return { kpis: emptyKpis(), peak: 0, bankCommitted: 0, durationMonths: 0, cycles: [] };
  const r = runSim(catalog, settings, units);
  if ("error" in r)
    return { kpis: emptyKpis(), peak: 0, bankCommitted: 0, durationMonths: 0, cycles: [], error: r.error };
  return {
    kpis: r.kpis,
    peak: r.kpis.peakCapital,
    bankCommitted: r.kpis.bankCommitted,
    durationMonths: Math.round(r.kpis.durationDays / 30),
    cycles: cyclesBreakdown(lines),
  };
}

function emptyKpis(): ProgramKpis {
  return {
    totalInvested: 0, totalReturned: 0, profit: 0, irrAnnual: null, irrMonthly: null,
    equityMultiple: null, peakCapital: 0, durationDays: 0, perfFeeTotal: 0, promoteTotal: 0,
    contractorFeeTotal: 0, bankCommitted: 0, bankUpfrontFees: 0, bankInterestTotal: 0,
    bankOtherFees: 0, bankReserveFunded: 0, bankReserveUnused: 0, bankExtensionFee: 0,
    cashToClosing: 0, equityGateAmount: 0, loanClosingDay: null, vehicleCostTotal: 0,
  };
}

// ── a busca ────────────────────────────────────────────────────────────────
export function optimizeProgram(catalog: CatalogData, input: OptimizerInput): OptimizerResult {
  const { equityTarget, horizonMonths, settings } = input;
  const warnings: string[] = [];

  // 1. Sonda os combos elegíveis e ranqueia por eficiência de capital
  const eligible = catalog.combos.filter((c) => input.locationIds.includes(c.locationId));
  const econ = eligible
    .map((c) => probeCombo(catalog, input, c))
    .filter((e): e is ComboEcon => e != null)
    .sort((a, b) => b.effic - a.effic);
  if (econ.length === 0) {
    return {
      ...evaluateProgram(catalog, settings, []),
      lines: [], econ: [], units: [], idleEquity: equityTarget, overSpend: 0,
      warnings: ["Nenhuma combinação elegível com custos preenchidos nos locais escolhidos."],
    };
  }

  // K ondas: quantas cabem no horizonte (esteira). Meta com folga — arredonda.
  // Regra do motor (Stefan): a esteira é só EQUITY; no BANCO é UMA leva (uma LLC/loan por
  // ciclo), então K=1 — o modo banco entrega a leva alavancada, não a esteira.
  const horizonDays = horizonMonths * 30;
  const repCycle = median(econ.map((e) => e.cycleDays));
  const isBank = settings.fundingMode === "BANK";
  let K = isBank ? 1 : Math.min(8, Math.max(1, Math.round(horizonDays / repCycle)));

  const lines: BasketLine[] = econ.map((e) => ({
    locationId: e.locationId, modelId: e.modelId, locationName: e.locationName, modelName: e.modelName,
    cycle1: 0, cycles: K, over: false, cap: e.cap, source: e.source, perYear: e.perYear,
    eqUnit: e.eqUnit, bankUnit: e.bankUnit, profitUnit: e.profitUnit, cycleDays: e.cycleDays,
  }));

  // 2. Preenchimento inicial (estimativa por eqUnit): dentro do cap por eficiência…
  const clampCap = (l: BasketLine, n: number) =>
    // BANCO = UMA leva: a absorção é teto firme (não se vende N iguais ao mesmo tempo).
    // EQUITY = esteira: o excesso se dilui pelos ciclos/tempo, então pode passar do cap.
    isBank && l.cap != null ? Math.min(n, l.cap) : n;
  let estPeak = 0;
  for (const l of lines) {
    while ((l.cap == null || l.cycle1 < l.cap) && estPeak + l.eqUnit <= equityTarget) {
      l.cycle1++; estPeak += l.eqUnit;
    }
  }
  // …e, se faltou p/ gastar o alvo: no EQUITY espalha o excesso (resp. 1a) round-robin por
  // eficiência; no BANCO respeita os caps (o ocioso é reportado, não forçado).
  let guard = 0;
  while (estPeak < equityTarget && guard++ < 2000) {
    let added = false;
    for (const l of lines) {
      if (estPeak >= equityTarget) break;
      const next = clampCap(l, l.cycle1 + 1);
      if (next > l.cycle1) { l.cycle1 = next; estPeak += l.eqUnit; added = true; }
    }
    if (!added) break; // BANCO: todos no cap e ainda abaixo do alvo → para (ocioso)
  }

  // 3. Calibra as contagens contra o PICO real do motor (o alvo tem que ser gasto)
  let evalr = evaluateProgram(catalog, settings, lines);
  for (let iter = 0; iter < 5; iter++) {
    const peak = evalr.peak;
    if (peak > 0 && peak >= equityTarget * 0.98 && peak <= equityTarget * 1.06) break;
    const scale = peak > 0 ? equityTarget / peak : 1;
    if (scale > 1 && isBank && lines.every((l) => l.cap != null && l.cycle1 >= l.cap)) break; // no cap, não força
    let changed = false;
    for (const l of lines) {
      const next = clampCap(l, Math.max(0, Math.round(l.cycle1 * scale)));
      if (next !== l.cycle1) { l.cycle1 = next; changed = true; }
    }
    if (!changed) break;
    evalr = evaluateProgram(catalog, settings, lines);
  }

  // 4. Ajusta K se a duração estourar demais o horizonte (folga, mas não muito)
  let kGuard = 0;
  while (evalr.durationMonths > horizonMonths * 1.2 && K > 1 && kGuard++ < 6) {
    K--;
    for (const l of lines) l.cycles = K;
    evalr = evaluateProgram(catalog, settings, lines);
  }

  // 5. Flags de absorção + avisos
  for (const l of lines) l.over = l.cap != null && l.cycle1 > l.cap;
  const kept = lines.filter((l) => l.cycle1 > 0);
  const overLocs = [...new Set(kept.filter((l) => l.over).map((l) => l.locationName))];
  if (overLocs.length) warnings.push(`Acima da absorção do mercado em: ${overLocs.join(", ")}.`);
  const noData = [...new Set(kept.filter((l) => l.source === "NONE").map((l) => l.locationName))];
  if (noData.length) warnings.push(`Sem dado de absorção (usar com cautela): ${noData.join(", ")}.`);
  const idleEquity = Math.max(0, equityTarget - evalr.peak);
  if (idleEquity > equityTarget * 0.05) {
    const hint = isBank
      ? "a absorção limita uma leva alavancada — use o modo Equity (multi-ciclo) ou adicione locais"
      : "adicione locais ou estenda o prazo";
    warnings.push(
      `Sobrou $${Math.round(idleEquity).toLocaleString("en-US")} de equity ocioso — ${hint} para consumir o alvo.`,
    );
  }

  return {
    ...evalr,
    lines: kept,
    econ,
    units: linesToUnits(kept),
    idleEquity,
    overSpend: Math.max(0, evalr.peak - equityTarget),
    warnings,
  };
}
