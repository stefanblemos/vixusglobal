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

export type Diversity = "CONCENTRATE" | "BALANCE" | "SPREAD";

export type OptimizerInput = {
  equityTarget: number;
  horizonMonths: number;
  locationIds: string[];
  sharePct?: number; // participação de mercado tolerada do mesmo modelo (default 8%)
  diversity?: Diversity; // quanto distribuir modelos/locais (default BALANCE)
  reinvest?: boolean; // reinvestir o lucro em ondas crescentes (só EQUITY multi-ciclo)
  absorptionByLocation: Record<string, number | null>; // manual do Catalog por locationId
  settings: OptimizerSettings;
};

// Teto de participação de UMA combinação no total de casas — o freio da diversificação.
// Concentrar = sem teto (máx TIR); Espalhar = no máx ~18% por combo (força o mix).
const MAX_SHARE: Record<Diversity, number> = { CONCENTRATE: 1, BALANCE: 0.3, SPREAD: 0.18 };

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
  growth: number; // fator de crescimento das ondas (1 = iguais; >1 = reinvestir o lucro)
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

// Casas de uma linha no ciclo c, com o crescimento do reinvestimento (g^(c-1)).
const cycleQty = (l: BasketLine, cycle: number, growth: number) =>
  Math.max(0, Math.round(l.cycle1 * Math.pow(growth, cycle - 1)));

// UnitRefs de uma cesta: por linha, as casas de cada uma das K ondas (crescentes se growth>1).
function linesToUnits(lines: BasketLine[], growth = 1): UnitRef[] {
  const units: UnitRef[] = [];
  for (const l of lines) {
    if (l.cycle1 <= 0) continue;
    for (let c = 1; c <= l.cycles; c++) {
      const n = cycleQty(l, c, growth);
      for (let i = 0; i < n; i++) {
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

function cyclesBreakdown(lines: BasketLine[], growth = 1): CycleBreakdown[] {
  const K = Math.max(1, ...lines.map((l) => l.cycles));
  const out: CycleBreakdown[] = [];
  for (let c = 1; c <= K; c++) {
    const active = lines.filter((l) => l.cycle1 > 0 && l.cycles >= c);
    const items = active.map((l) => ({
      locationName: l.locationName, modelName: l.modelName, qty: cycleQty(l, c, growth), over: l.over,
    }));
    out.push({
      cycle: c,
      houses: items.reduce((s, i) => s + i.qty, 0),
      equityWave: active.reduce((s, l) => s + cycleQty(l, c, growth) * l.eqUnit, 0),
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
  growth = 1,
): ProgramEval {
  const units = linesToUnits(lines, growth);
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
    cycles: cyclesBreakdown(lines, growth),
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
      lines: [], econ: [], units: [], growth: 1, idleEquity: equityTarget, overSpend: 0,
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

  // 2. Preenchimento por PASSO (rodízio por eficiência), com dois freios:
  //    - absorção: teto firme no BANCO (uma leva); no EQUITY dilui pelos ciclos;
  //    - diversidade: nenhum combo passa de MAX_SHARE do total (força o mix de modelos/locais).
  //    Mantém a diversidade o máximo possível e só a relaxa em último caso p/ gastar o alvo.
  const maxShare = MAX_SHARE[input.diversity ?? "BALANCE"];
  let estPeak = 0;
  let total = 0;
  // Combo SEM absorção (cap null): no BANCO ganha um teto conservador (não se enche uma leva
  // de um produto sem dado de mercado); no EQUITY fica livre (dilui pelos ciclos).
  const NONE_CAP_BANK = 5;
  const capBlocked = (l: BasketLine, relaxCap: boolean) => {
    const ec = l.cap != null ? l.cap : isBank ? NONE_CAP_BANK : null;
    return ec != null && l.cycle1 >= ec && (isBank || !relaxCap);
  };
  const shareBlocked = (l: BasketLine, relaxShare: boolean) =>
    !relaxShare && maxShare < 1 && l.cycle1 + 1 > Math.max(1, maxShare * (total + 1));
  const fillPass = (relaxShare: boolean, relaxCap: boolean) => {
    let guard = 0;
    while (estPeak < equityTarget && guard++ < 8000) {
      // lines já ordenado por eficiência desc → o 1º elegível é o melhor
      const pick = lines.find((l) => !capBlocked(l, relaxCap) && !shareBlocked(l, relaxShare));
      if (!pick) return;
      pick.cycle1++; total++; estPeak += pick.eqUnit;
    }
  };
  fillPass(false, false); // estrito: dentro do cap e da diversidade
  if (isBank) {
    fillPass(true, false); // banco: absorção é teto → concentra dentro dos caps p/ usar capacidade
  } else {
    fillPass(false, true); // equity: espalha o excesso pelos ciclos, mantendo a diversidade
    fillPass(true, true); // último caso: relaxa a diversidade só p/ consumir o alvo
  }

  // 3. Calibra contra o PICO REAL do motor adicionando/removendo casas por eficiência
  //    (o estimador por eqUnit superestima o pico — a esteira recicla). Adicionar mantém a
  //    diversidade (respeita o share) e só relaxa em último caso p/ consumir o alvo.
  const calibrate = (): ProgramEval => {
    let ev = evaluateProgram(catalog, settings, lines);
    for (let iter = 0; iter < 7; iter++) {
      const peak = ev.peak;
      if (peak > 0 && peak >= equityTarget * 0.98 && peak <= equityTarget * 1.08) break;
      if (peak < equityTarget) {
        let need = equityTarget - peak;
        const before = total;
        const addBatch = (relaxShare: boolean, relaxCap: boolean) => {
          let g = 0;
          while (need > 0 && g++ < 8000) {
            const pick = lines.find((l) => !capBlocked(l, relaxCap) && !shareBlocked(l, relaxShare));
            if (!pick) return;
            pick.cycle1++; total++; need -= pick.eqUnit;
          }
        };
        addBatch(false, !isBank); // mantém diversidade; equity pode passar do cap (esteira)
        if (need > 0 && !isBank) addBatch(true, true); // último caso: relaxa p/ gastar o alvo
        if (total === before) break; // banco no cap → não força (ocioso reportado)
      } else {
        let excess = peak - equityTarget;
        for (let i = lines.length - 1; i >= 0 && excess > 0; i--) {
          const l = lines[i]; // menor eficiência primeiro
          while (l.cycle1 > 0 && excess > 0) { l.cycle1--; total--; excess -= l.eqUnit; }
        }
      }
      ev = evaluateProgram(catalog, settings, lines);
    }
    return ev;
  };
  // BANCO = uma leva: a absorção é o teto natural — enche até os caps e reporta o ocioso,
  // sem forçar o alvo (isso é papel do EQUITY multi-ciclo). EQUITY calibra p/ gastar o alvo.
  let evalr = isBank ? evaluateProgram(catalog, settings, lines) : calibrate();

  // 4. Ajusta K se a duração estourar demais o horizonte (folga, mas não muito). Cortar K
  //    derruba o pico (menos sobreposição de ciclos) → RECALIBRA depois p/ voltar ao alvo.
  let kGuard = 0;
  let kChanged = false;
  while (evalr.durationMonths > horizonMonths * 1.2 && K > 1 && kGuard++ < 6) {
    K--;
    for (const l of lines) l.cycles = K;
    kChanged = true;
    evalr = evaluateProgram(catalog, settings, lines);
  }
  if (kChanged) evalr = calibrate();

  // 4b. REINVESTIR O LUCRO (só EQUITY multi-ciclo): busca o ritmo de crescimento das ondas
  //     que MAXIMIZA o lucro mantendo o pico do investidor ≤ alvo×1.10. As casas extras dos
  //     ciclos seguintes são financiadas pelo caixa reciclado (o pico não sobe até saturar).
  let growth = 1;
  if ((input.reinvest ?? false) && !isBank && K > 1) {
    // O crescimento não pode passar do pico da versão PLANA (o comprometimento do grupo já
    // fixado) — a promessa é "mesmo capital, mais lucro". Pequena folga de 2%.
    const peakCap = Math.max(evalr.peak, equityTarget) * 1.02;
    let best = { g: 1, ev: evalr };
    for (const g of [1.05, 1.1, 1.15, 1.2, 1.25, 1.3, 1.35, 1.4]) {
      const ev = evaluateProgram(catalog, settings, lines, g);
      if (ev.peak > peakCap) break; // monotônico: passou do teto, não adianta crescer mais
      if (ev.kpis.profit > best.ev.kpis.profit) best = { g, ev };
    }
    growth = best.g;
    evalr = best.ev;
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
    units: linesToUnits(kept, growth),
    growth,
    idleEquity,
    overSpend: Math.max(0, evalr.peak - equityTarget),
    warnings,
  };
}
