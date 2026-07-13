/**
 * Stress test do motor de simulação (puro, sem DB): roda a matriz
 * cenário × funding × remuneração × plano × banco e verifica invariantes:
 *  1. Caixa nunca negativo; aporte JIT zera o caixa exatamente (nunca aporta com sobra).
 *  2. Conservação: Σ(amount) dos eventos ≈ 0 (nada some nem aparece).
 *  3. Saldo do loan nunca negativo além de crédito final; termina em 0.
 *  4. Fees upfront batem com o perfil ao centavo.
 *  5. TIR Ótimo ≥ Real ≥ Conservador (mesma cesta/config).
 *  6. Equity − Banco = custo do banco (fees + juros + extensão), p/ modos com fee
 *     independente do funding (contractor, open book, performance).
 *  7. Par draw: todo BANK_DRAW tem pagamento de obra no MESMO dia com o mesmo valor.
 *  8. Reserve: financiada = consumida + devolvida.
 * Uso: npx tsx scripts/stress-sim.ts
 */
import { simulate, type SimInput, type SimBank, type SimScenario, type SimUnitInput } from "../src/lib/pools/simulator";

const OPT: SimScenario = { salePriceBufferPct: 0, constructionCostBufferPct: 0, lotCostBufferPct: 0, closingFeePct: 6, contingencyReservePct: 0, landAcquisitionDays: 15, saleClosingDays: 45, constructionDurationBufferM: 0, salesAbsorptionMonths: null, emdPct: 5, stressSlippagePct: 0 } as unknown as SimScenario;
const REAL: SimScenario = { ...OPT, salePriceBufferPct: -3, constructionCostBufferPct: 5, lotCostBufferPct: 3, contingencyReservePct: 3, constructionDurationBufferM: 1 } as SimScenario;
const CONS: SimScenario = { ...OPT, salePriceBufferPct: -8, constructionCostBufferPct: 10, lotCostBufferPct: 5, contingencyReservePct: 5, constructionDurationBufferM: 2, salesAbsorptionMonths: 2 } as SimScenario;
const SCENARIOS: Array<[string, SimScenario]> = [["OPT", OPT], ["REAL", REAL], ["CONS", CONS]];

const UNITS: SimUnitInput[] = [
  { label: "Casa A", locationName: "L1", modelName: "A", permitDays: 45, lotLeadDays: 10, saleDays: 60, buildMonths: 5, costPerformance: 200000, costContractor: 185000, costOpenBook: 190000, contractorFee: 25000, lotCost: 48000, salePrice: 310000, cycle: 1 },
  { label: "Casa B", locationName: "L1", modelName: "B", permitDays: 45, lotLeadDays: 10, saleDays: 60, buildMonths: 6, costPerformance: 260000, costContractor: 240000, costOpenBook: 248000, contractorFee: 30000, lotCost: 60000, salePrice: 405000, cycle: 1 },
  { label: "Casa C", locationName: "L2", modelName: "A", permitDays: 30, lotLeadDays: 10, saleDays: 45, buildMonths: 5, costPerformance: 200000, costContractor: 185000, costOpenBook: 190000, contractorFee: 25000, lotCost: 42000, salePrice: 298000, cycle: 1 },
];

const noCustom: SimBank["customFees"] = [];
const BC: SimBank = { ltcBuildPct: 80, ltcLandPct: 0, financeLand: false, ltvPct: 70, haircutPct: 5, perUnitCap: null, closingPermitPct: 80, effectiveAprPct: 9, interestBasis: "DRAWN", originationPct: 1.75, originationFlat: 0, brokerPct: 1, titleEscrowPct: 1.33, closingFeePct: 0, processingFee: 2000, budgetReviewFee: 4000, appraisalFee: 0, legalFee: 2500, feesFinanced: true, servicingMonthly: 0, inspectionFeePerDraw: 185, drawProcessingFee: 20, achFeePerBatch: 20, hasInterestReserve: true, reserveMonths: 6, reserveInEnvelope: true, overfundingMode: "REFUND_IN_DRAWS", releaseMode: "SWEEP_PCT_LAST_FULL", sweepPct: 85, reconveyanceFee: 350, termMonths: 12, extensionFeePct: 1, applyExtensionFee: false, customFees: [{ name: "LO credit", timing: "CLOSING", kind: "FLAT", amount: -3000 }] };
const RBI: SimBank = { ...BC, ltcBuildPct: 90, effectiveAprPct: 9, originationPct: 1.75, brokerPct: 1, titleEscrowPct: 0, processingFee: 495, budgetReviewFee: 475, appraisalFee: 600, legalFee: 500, feesFinanced: false, inspectionFeePerDraw: 295, drawProcessingFee: 0, achFeePerBatch: 0, hasInterestReserve: false, reserveMonths: 6, reserveInEnvelope: false, overfundingMode: "REFUND_AT_CLOSING", releaseMode: "SWEEP_FULL", sweepPct: 100, reconveyanceFee: 0, customFees: [{ name: "Underwriting", timing: "CLOSING", kind: "FLAT", amount: 1500 }] };
const DUTCH: SimBank = { ...BC, interestBasis: "COMMITTED", feesFinanced: false, hasInterestReserve: false, customFees: noCustom };
const BANKS: Array<[string, SimBank | null]> = [["EQUITY", null], ["BC", BC], ["RBI", RBI], ["DUTCH", DUTCH]];

const COMPS: Array<[string, Partial<SimInput>]> = [
  ["PERF", { compMode: "PERFORMANCE", perfPct: 0.35, perfTiming: "PROJECT_COMPLETION" }],
  ["PERF_SALE", { compMode: "PERFORMANCE", perfPct: 0.35, perfTiming: "PER_SALE" }],
  ["CONTRACTOR", { compMode: "CONTRACTOR_FEE" }],
  ["OPEN_BOOK", { compMode: "OPEN_BOOK", flatFeePerHouse: 20000 }],
  ["OPEN_BOOK_PROMOTE", { compMode: "OPEN_BOOK", flatFeePerHouse: 20000, promoteTiers: [{ hurdlePct: 8, promotePct: 0 }, { hurdlePct: null, promotePct: 30 }] }],
  ["PROMOTE", { compMode: "PROMOTE", promoteTiers: [{ hurdlePct: 8, promotePct: 0 }, { hurdlePct: 15, promotePct: 20 }, { hurdlePct: null, promotePct: 35 }] }],
];
const PLANS: Array<"STANDARD" | "LIGHT_START" | "PARTNER"> = ["STANDARD", "LIGHT_START", "PARTNER"];

function baseInput(sc: SimScenario, bank: SimBank | null): SimInput {
  return {
    fundingMode: bank ? "BANK" : "EQUITY",
    upfrontFunding: false,
    compMode: "PERFORMANCE",
    flatFeePerHouse: 0,
    perfPct: 0.35,
    perfTiming: "PROJECT_COMPLETION",
    promoteTiers: null,
    paymentPlan: "STANDARD",
    equityGatePct: 0.1,
    unitGapDays: 3,
    scenario: sc,
    bank,
    units: UNITS,
  };
}

const upfrontExpected = (bank: SimBank, committed: number) =>
  Math.round(
    ((committed * (bank.closingFeePct + bank.originationPct + bank.brokerPct + bank.titleEscrowPct)) / 100 +
      bank.originationFlat + bank.processingFee + bank.budgetReviewFee + bank.appraisalFee + bank.legalFee +
      bank.customFees.filter((f) => f.timing === "CLOSING").reduce((s, f) => s + (f.kind === "PCT_COMMITTED" ? (committed * f.amount) / 100 : f.amount), 0)) * 100,
  ) / 100;

let failures = 0;
let runs = 0;
const fail = (tag: string, msg: string) => {
  failures++;
  console.log(`FAIL [${tag}] ${msg}`);
};

for (const [scName, sc] of SCENARIOS) {
  for (const [bankName, bank] of BANKS) {
    for (const [compName, comp] of COMPS) {
      for (const plan of PLANS) {
        const tag = `${scName}/${bankName}/${compName}/${plan}`;
        const input: SimInput = { ...baseInput(sc, bank), ...comp, paymentPlan: plan } as SimInput;
        const r = simulate(input);
        runs++;

        // 1. caixa: nunca negativo; aporte só quando o caixa não cobre (zera após o gasto)
        let prevWasInjection = false;
        let prevCashBeforeInjection = 0;
        for (const e of r.events) {
          if (e.cash < -0.01) fail(tag, `caixa negativo ${e.cash} no dia ${e.day} (${e.label})`);
          if (prevWasInjection && e.kind !== "INJECTION") {
            if (e.cash > 0.01 && e.amount < 0)
              fail(tag, `aporte com sobra: caixa ${e.cash} após gasto pós-aporte no dia ${e.day}`);
            prevWasInjection = false;
          }
          if (e.kind === "INJECTION") prevWasInjection = true;
        }

        // 2. conservação: soma de todos os movimentos de caixa ≈ 0
        const sum = r.events.reduce((s, e) => s + e.amount, 0);
        if (Math.abs(sum) > 0.05) fail(tag, `conservação: Σ eventos = ${sum.toFixed(2)}`);

        // 3. loan termina em 0 e nunca fica "negativo demais" (crédito final permitido)
        const lastBank = r.events[r.events.length - 1]?.bankBalance ?? 0;
        if (bank && Math.abs(lastBank) > 0.02) fail(tag, `saldo final do loan = ${lastBank}`);

        // 4. fees upfront ao centavo
        if (bank) {
          const exp = upfrontExpected(bank, r.kpis.bankCommitted);
          if (Math.abs(r.kpis.bankUpfrontFees - exp) > 0.01)
            fail(tag, `fees upfront ${r.kpis.bankUpfrontFees} ≠ esperado ${exp}`);
        }

        // 7. par draw: todo "Draw do banco" tem pagamento de obra no mesmo dia com
        //    valor ≥ draw (no modo in-draws o budget pode ficar abaixo do custo);
        //    linhas de "Excedente da medição" e CTC são desembolso puro (sem par)
        const drawsIn = r.events.filter(
          (e) => e.kind === "BANK_DRAW" && !e.label.startsWith("Excedente da medição"),
        );
        for (const d of drawsIn) {
          const match = r.events.find(
            (e) => e.day === d.day && e.kind === "PHASE" && -e.amount >= d.amount - 0.01,
          );
          if (!match) fail(tag, `draw sem par de obra no dia ${d.day} ($${d.amount})`);
        }

        // 8. reserve fecha: financiada = consumida + devolvida
        if (bank?.hasInterestReserve) {
          const consumed = r.kpis.bankReserveFunded - r.kpis.bankReserveUnused;
          if (consumed < -0.01) fail(tag, `reserve consumida negativa (${consumed})`);
        }

        // 9. banco NUNCA paga permit (F1/F2) e nenhum draw antes de closing+15
        for (const d of drawsIn) {
          if (/Fase [12] •/.test(d.label)) fail(tag, `draw do banco pagando permit: ${d.label}`);
        }
        if (bank && drawsIn.length > 0) {
          const closingDay = r.events.find(
            (e) => e.kind === "BANK_FEE" || e.kind === "BANK_RESERVE",
          )?.day;
          const firstDraw = Math.min(...drawsIn.map((d) => d.day));
          if (closingDay != null && firstDraw < closingDay + 15)
            fail(tag, `draw ${firstDraw} antes de closing+15 (${closingDay + 15})`);
        }
      }
    }
  }
}

// 11. cash to closing: cheque só ≥ closing+15; identidade do envelope fecha
//     (comprometido = fees rolados + reserve-no-envelope + draws + CTC)
for (const [bankName, bank] of BANKS.filter(([, b]) => b)) {
  for (const [scName, sc] of SCENARIOS) {
    const r = simulate(baseInput(sc, bank));
    const tag = `CTC/${scName}/${bankName}`;
    const ctcEvents = r.events.filter((e) => e.kind === "BANK_CTC");
    if (ctcEvents.length > 1) fail(tag, `${ctcEvents.length} eventos de CTC (esperado ≤1)`);
    const closingDay = r.events.find((e) => e.kind === "BANK_FEE" || e.kind === "BANK_RESERVE")?.day;
    for (const e of ctcEvents) {
      if (e.amount > 0 && closingDay != null && e.day < closingDay + 15)
        fail(tag, `cheque do CTC no dia ${e.day}, antes de closing+15 (${closingDay + 15})`);
      if (Math.abs(e.amount - r.kpis.cashToClosing) > 0.01)
        fail(tag, `evento CTC ${e.amount} ≠ kpi ${r.kpis.cashToClosing}`);
    }
    if (Math.abs(r.kpis.cashToClosing) > 0.01) {
      const draws = r.events.filter((e) => e.kind === "BANK_DRAW").reduce((s2, e) => s2 + e.amount, 0);
      const envelope =
        (bank!.feesFinanced ? r.kpis.bankUpfrontFees : 0) +
        (bank!.reserveInEnvelope ? r.kpis.bankReserveFunded : 0) +
        draws +
        r.kpis.cashToClosing;
      if (Math.abs(envelope - r.kpis.bankCommitted) > 0.05)
        fail(tag, `envelope ${envelope.toFixed(2)} ≠ comprometido ${r.kpis.bankCommitted}`);
    }
  }
}

// 13. Esteira de ciclos (equity): casa engatilhada começa a obra no dia seguinte à
//     venda-gatilho do ciclo anterior (1:1 na ordem; extras na última venda), ou espera
//     o permit quando a conta de chegada não fecha; F2 nunca antes do início da obra
{
  const CYCLED: SimUnitInput[] = [
    ...UNITS.map((u) => ({ ...u })),
    ...UNITS.map((u) => ({ ...u, cycle: 2, label: `C2 ${u.label}` })),
    { ...UNITS[0], cycle: 3, label: "C3 Casa A" },
    { ...UNITS[1], cycle: 3, label: "C3 Casa B" },
    { ...UNITS[0], cycle: 3, label: "C3 Casa A2" },
    { ...UNITS[2], cycle: 3, label: "C3 Casa C" },
  ];
  for (const [scName, sc] of SCENARIOS) {
    const r = simulate({ ...baseInput(sc, null), units: CYCLED });
    const tag = `CYCLES/${scName}`;
    for (const e of r.events) if (e.cash < -0.01) fail(tag, `caixa negativo ${e.cash} no dia ${e.day}`);
    const sum = r.events.reduce((s2, e) => s2 + e.amount, 0);
    if (Math.abs(sum) > 0.05) fail(tag, `conservação: Σ = ${sum.toFixed(2)}`);
    for (const k of [2, 3]) {
      const prevSales = r.units.filter((u) => u.cycle === k - 1).map((u) => u.tCashIn).sort((a, b) => a - b);
      r.units.filter((u) => u.cycle === k).forEach((u, j) => {
        const trig = prevSales[Math.min(j, prevSales.length - 1)];
        const expected = Math.max(trig + 1, u.tPermitOk);
        if (u.tBuildStart !== expected)
          fail(tag, `C${k} obra em D+${u.tBuildStart}, esperado D+${expected} (gatilho ${trig})`);
        const f2 = r.events.find((e) => e.kind === "PHASE" && e.label.includes("Fase 2") && e.label.includes(u.label));
        if (f2 && f2.day < u.tBuildStart)
          fail(tag, `C${k} F2 em D+${f2.day} antes da obra D+${u.tBuildStart} (deveria ser paga da venda)`);
      });
    }
    // programa: TIR com esteira ≥ TIR da mesma cesta toda em ciclo 1 (capital girando)
    const flat = simulate({ ...baseInput(sc, null), units: CYCLED.map((u) => ({ ...u, cycle: 1 })) });
    if (
      r.kpis.irrAnnual != null && flat.kpis.irrAnnual != null &&
      flat.kpis.irrAnnual > 0 && r.kpis.irrAnnual < flat.kpis.irrAnnual - 1e-9 &&
      r.kpis.peakCapital > flat.kpis.peakCapital
    )
      fail(tag, `esteira piorou TIR (${r.kpis.irrAnnual}) vs tudo-junto (${flat.kpis.irrAnnual}) sem reduzir pico`);
  }
}

// 12. REFUND_IN_DRAWS: banco desembolsa o budget cheio nos draws — Σ draws (incl.
//     excedentes) = comprometido − fees rolados − reserve-no-envelope; CTC = 0
for (const [scName, sc] of SCENARIOS) {
  const r = simulate(baseInput(sc, BC));
  const tag = `INDRAWS/${scName}/BC`;
  const totalDraws = r.events
    .filter((e) => e.kind === "BANK_DRAW")
    .reduce((s2, e) => s2 + e.amount, 0);
  const expected =
    r.kpis.bankCommitted -
    (BC.feesFinanced ? r.kpis.bankUpfrontFees : 0) -
    (BC.reserveInEnvelope ? r.kpis.bankReserveFunded : 0);
  if (Math.abs(totalDraws - expected) > 0.05)
    fail(tag, `Σ draws ${totalDraws.toFixed(2)} ≠ comprometido−fees−reserve ${expected.toFixed(2)}`);
  if (Math.abs(r.kpis.cashToClosing) > 0.01)
    fail(tag, `CTC deveria ser 0 no modo in-draws (veio ${r.kpis.cashToClosing})`);
}

// 10. aporte 100% em D+0: um único aporte no dia 0, caixa nunca negativo, TIR ≤ JIT
for (const [bankName, bank] of BANKS) {
  for (const [scName, sc] of SCENARIOS) {
    const jit = simulate({ ...baseInput(sc, bank) });
    const up = simulate({ ...baseInput(sc, bank), upfrontFunding: true });
    const tag = `UPFRONT/${scName}/${bankName}`;
    const injections = up.events.filter((e) => e.kind === "INJECTION");
    if (injections.length !== 1 || injections[0].day !== 0)
      fail(tag, `esperado 1 aporte em D+0, veio ${injections.length} (dias ${injections.map((e) => e.day).join(",")})`);
    for (const e of up.events) if (e.cash < -0.01) fail(tag, `caixa negativo ${e.cash} no dia ${e.day}`);
    const sum = up.events.reduce((s2, e) => s2 + e.amount, 0);
    if (Math.abs(sum) > 0.05) fail(tag, `conservação: Σ = ${sum.toFixed(2)}`);
    // capital parado só REDUZ a TIR quando há lucro; no prejuízo, base maior dilui a taxa
    if (
      jit.kpis.irrAnnual != null && up.kpis.irrAnnual != null &&
      jit.kpis.irrAnnual > 0 && up.kpis.irrAnnual > jit.kpis.irrAnnual + 1e-9
    )
      fail(tag, `TIR upfront ${up.kpis.irrAnnual} > JIT ${jit.kpis.irrAnnual}`);
    if (up.kpis.peakCapital < jit.kpis.peakCapital - 0.02)
      fail(tag, `pico upfront ${up.kpis.peakCapital} < JIT ${jit.kpis.peakCapital}`);
  }
}

// 5. ordem dos cenários (mesma config, TIR por cenário) — todas as combinações funding×comp
for (const [bankName, bank] of BANKS) {
  for (const [compName, comp] of COMPS) {
    const irrs = SCENARIOS.map(([, sc]) => {
      const r = simulate({ ...baseInput(sc, bank), ...comp } as SimInput);
      return r.kpis.irrAnnual;
    });
    const [opt, real, cons] = irrs;
    if (opt != null && real != null && opt < real - 1e-9)
      fail(`${bankName}/${compName}`, `TIR OPT ${opt} < REAL ${real}`);
    if (real != null && cons != null && real < cons - 1e-9)
      fail(`${bankName}/${compName}`, `TIR REAL ${real} < CONS ${cons}`);
  }
}

// 6. equity − banco = custo do banco (modos com fee 4U independente do funding)
for (const [bankName, bank] of BANKS.filter(([, b]) => b)) {
  for (const [compName, comp] of COMPS.filter(([n]) => ["CONTRACTOR", "OPEN_BOOK", "PERF", "PERF_SALE"].includes(n))) {
    for (const [scName, sc] of SCENARIOS) {
      const eq = simulate({ ...baseInput(sc, null), ...comp } as SimInput);
      const bk = simulate({ ...baseInput(sc, bank), ...comp } as SimInput);
      const bankCost =
        bk.kpis.bankUpfrontFees + bk.kpis.bankInterestTotal + bk.kpis.bankOtherFees + bk.kpis.bankExtensionFee;
      const diff = eq.kpis.profit - bk.kpis.profit;
      if (Math.abs(diff - bankCost) > 0.5)
        fail(`${scName}/${bankName}/${compName}`, `equity−banco = ${diff.toFixed(2)} ≠ custo do banco ${bankCost.toFixed(2)}`);
    }
  }
}

console.log(`\n${runs} combinações + cenário-ordem + equity×banco · ${failures === 0 ? "TODAS AS INVARIANTES OK ✓" : failures + " FALHAS"}`);
process.exit(failures === 0 ? 0 : 1);
