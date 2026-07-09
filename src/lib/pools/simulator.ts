/**
 * Motor do simulador de tese de investimento (pré-pool).
 *
 * Portado do mockup investment-simulator-v15c com as correções combinadas:
 * - modelo+local é chave composta (o mock perdia os modelos de Citrus);
 * - buffers/cenários (Ótimo/Real/Conservador) aplicados no cronograma e nos valores;
 * - modalidade da 4U: contractor fee fixo por tipo OU performance (% do lucro líquido,
 *   ANTES do split com investidores — default 35%);
 * - aportes JIT exatos como no mock (a regra de múltiplos de $1.000 é da CAPTAÇÃO/cota
 *   societária nos pools reais, não do fluxo de caixa do projeto);
 * - modo BANK integrado ao mesmo ledger (o "owner" é o pool): sizing min(LTC, LTV, cap),
 *   equity gate, fees upfront, juros mensais sobre o sacado, interest reserve on/off
 *   (off → juros viram necessidade de aporte), payoff na venda.
 *
 * Tudo em number (não Decimal): é simulação/projeção, não contabilidade.
 * Calendário simplificado do mock: mês = 30 dias, ano = 365.
 */

export type SimScenario = {
  salePriceBufferPct: number; // +5 / 0 / -7 (em %)
  constructionCostBufferPct: number;
  lotCostBufferPct: number;
  closingFeePct: number; // % da venda (7.5 / 8 / 9)
  contingencyReservePct: number; // % de (lote+obra)
  landAcquisitionDays: number;
  constructionDurationBufferM: number; // meses
  salesAbsorptionMonths: number | null; // null = usa saleDays do local
  emdPct: number;
};

export type SimBankCustomFee = {
  name: string;
  timing: "CLOSING" | "PER_DRAW" | "PER_DRAW_BATCH" | "MONTHLY" | "PER_PAYOFF" | "FINAL";
  kind: "FLAT" | "PCT_COMMITTED" | "PCT_PAYOFF";
  amount: number; // negativo = crédito (ex.: LO credit)
};

export type SimBank = {
  // sizing
  ltcBuildPct: number;
  ltcLandPct: number;
  financeLand: boolean;
  ltvPct: number;
  haircutPct: number;
  perUnitCap: number | null;
  closingPermitPct: number; // closing autorizado com X% dos permits emitidos (ceil)
  // juros
  effectiveAprPct: number; // fixa, ou índice+spread (resolvido no caller)
  interestBasis: "DRAWN" | "COMMITTED"; // non-Dutch | Dutch
  // closing
  originationPct: number;
  originationFlat: number;
  brokerPct: number;
  titleEscrowPct: number;
  closingFeePct: number; // outros, % do comprometido
  processingFee: number;
  budgetReviewFee: number;
  appraisalFee: number;
  legalFee: number;
  feesFinanced: boolean;
  // durante a obra
  servicingMonthly: number;
  inspectionFeePerDraw: number;
  drawProcessingFee: number;
  achFeePerBatch: number;
  // reserve
  hasInterestReserve: boolean;
  reserveMonths: number;
  // payoff
  releaseMode: "SWEEP_FULL" | "SWEEP_PCT_LAST_FULL";
  sweepPct: number;
  reconveyanceFee: number;
  // prazo
  termMonths: number;
  extensionFeePct: number;
  applyExtensionFee: boolean; // só no cenário Conservador
  customFees: SimBankCustomFee[];
};

export type SimUnitInput = {
  label: string; // "Modelo — Local"
  locationName: string;
  modelName: string;
  permitDays: number;
  lotLeadDays: number;
  saleDays: number;
  buildMonths: number;
  costPerformance: number; // custo de obra na modalidade performance (por local)
  costContractor: number; // custo-base contractor SEM o fee (por local)
  contractorFee: number; // fee fixo do tipo (ou override do modelo)
  lotCost: number; // sempre o lotCostEstimate do location
  salePrice: number;
};

export type PromoteTier = {
  hurdlePct: number | null; // retorno a.a. sobre o capital médio em risco; null = acima do último
  promotePct: number; // % da faixa que vai para a 4U
};

export type SimInput = {
  fundingMode: "EQUITY" | "BANK";
  compMode: "CONTRACTOR_FEE" | "PERFORMANCE" | "PROMOTE";
  perfPct: number; // fração (0.35) — modo PERFORMANCE
  perfTiming: "PER_SALE" | "PROJECT_COMPLETION";
  promoteTiers: PromoteTier[] | null; // modo PROMOTE (pago na conclusão)
  paymentPlan: "STANDARD" | "LIGHT_START"; // 10/30/20/20/15/5 ou 10/15/25/25/20/5
  equityGatePct: number; // fração
  parallelPermit: boolean;
  unitGapDays: number;
  scenario: SimScenario;
  bank: SimBank | null;
  units: SimUnitInput[];
};

export type SimEvent = {
  day: number;
  amount: number; // + entra no caixa do projeto, − sai
  label: string;
  kind:
    | "INJECTION" // aporte do investidor
    | "RETURN" // devolução/distribuição ao investidor
    | "LOT"
    | "PHASE"
    | "CONTINGENCY"
    | "SALE"
    | "PERF_FEE"
    | "BANK_FEE"
    | "BANK_INTEREST"
    | "BANK_PAYOFF";
  cash: number; // saldo do projeto após o evento
  invested: number; // capital do investidor em risco após o evento
  bankBalance: number; // saldo devedor do banco
};

export type SimUnitResult = SimUnitInput & {
  tReq: number;
  tLotClose: number;
  tPermitOk: number;
  tBuildStart: number;
  tCO: number;
  tCashIn: number;
  adjLot: number;
  adjBuild: number;
  adjSaleNet: number; // venda ajustada líquida de closing fee
  bankEligible: number;
  profit: number; // lucro da casa após perf fee (modo performance)
};

export type SimResult = {
  kpis: {
    totalInvested: number;
    totalReturned: number;
    profit: number;
    irrAnnual: number | null;
    irrMonthly: number | null;
    equityMultiple: number | null;
    peakCapital: number;
    durationDays: number;
    perfFeeTotal: number;
    contractorFeeTotal: number;
    bankCommitted: number;
    bankUpfrontFees: number;
    bankInterestTotal: number;
    bankReserveFunded: number;
    bankReserveUnused: number;
    bankExtensionFee: number;
    equityGateAmount: number;
  };
  events: SimEvent[];
  monthly: Array<{ month: number; inflow: number; outflow: number; balance: number }>;
  units: SimUnitResult[];
};

const round2 = (v: number) => Math.round(v * 100) / 100;

// XIRR (Newton-Raphson + bisseção), ACT/365 — portado do mock.
export function xirr(flows: Array<{ day: number; amount: number }>): number | null {
  const fs = flows.filter((f) => Math.abs(f.amount) > 1e-9);
  if (fs.length < 2) return null;
  if (!fs.some((f) => f.amount > 0) || !fs.some((f) => f.amount < 0)) return null;
  const t0 = Math.min(...fs.map((f) => f.day));
  const npv = (r: number) =>
    fs.reduce((s, f) => s + f.amount / Math.pow(1 + r, (f.day - t0) / 365), 0);
  let r = 0.2;
  for (let i = 0; i < 60; i++) {
    const v = npv(r);
    const dv = (npv(r + 1e-6) - v) / 1e-6;
    if (!Number.isFinite(dv) || Math.abs(dv) < 1e-12) break;
    const next = r - v / dv;
    if (!Number.isFinite(next) || next <= -0.999) break;
    if (Math.abs(next - r) < 1e-9) return next;
    r = next;
  }
  let lo = -0.9;
  let hi = 5.0;
  let flo = npv(lo);
  if (!Number.isFinite(flo)) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fm = npv(mid);
    if (Math.abs(fm) < 1e-7) return mid;
    if ((flo < 0 && fm < 0) || (flo > 0 && fm > 0)) {
      lo = mid;
      flo = fm;
    } else hi = mid;
  }
  return null;
}

type Flow = { day: number; amount: number; label: string; kind: SimEvent["kind"] };

// Cronograma de uma unidade (forward, unidades espaçadas por unitGapDays).
function schedule(u: SimUnitInput, idx: number, input: SimInput) {
  const sc = input.scenario;
  const tReq = idx * input.unitGapDays;
  const tLotClose = tReq + u.lotLeadDays + sc.landAcquisitionDays;
  const tPermitOk = (input.parallelPermit ? tReq : tLotClose) + u.permitDays;
  const tBuildStart = Math.max(tLotClose, tPermitOk);
  const buildDays = Math.max(30, Math.round((u.buildMonths + sc.constructionDurationBufferM) * 30));
  const tCO = tBuildStart + buildDays;
  const saleDays =
    sc.salesAbsorptionMonths != null ? Math.round(sc.salesAbsorptionMonths * 30) : u.saleDays;
  const tCashIn = tCO + saleDays;
  const tPermitApp = input.parallelPermit ? tReq : tLotClose;
  return { tReq, tLotClose, tPermitOk, tBuildStart, tCO, tCashIn, tPermitApp, buildDays };
}

// Planos de desembolso da obra (6 fases). LIGHT_START alivia o início: até o permit caem
// 25% (vs 40%) — exposição inicial ≈ lote + 25% da obra (+ juros estimados sem reserve).
const PHASE_NAMES = [
  "Permit application",
  "Permit issued",
  "Truss delivery",
  "Drywall installation",
  "Tile installation",
  "CO issued",
] as const;

export const PAYMENT_PLANS: Record<"STANDARD" | "LIGHT_START", number[]> = {
  STANDARD: [0.1, 0.3, 0.2, 0.2, 0.15, 0.05],
  LIGHT_START: [0.1, 0.15, 0.25, 0.25, 0.2, 0.05],
};

function phaseDays(s: ReturnType<typeof schedule>): number[] {
  return [
    s.tPermitApp,
    s.tPermitOk + 1,
    s.tBuildStart + Math.round(0.4 * s.buildDays),
    s.tBuildStart + Math.round(0.6 * s.buildDays),
    s.tBuildStart + Math.round(0.8 * s.buildDays),
    s.tCO + 10,
  ];
}

export function simulate(input: SimInput): SimResult {
  const sc = input.scenario;
  const emd = sc.emdPct / 100;
  const closingFee = sc.closingFeePct / 100;
  const perfOn = input.compMode === "PERFORMANCE";
  // PERFORMANCE e PROMOTE constroem ao custo direto (4U remunerada pelo resultado);
  // CONTRACTOR_FEE constrói ao custo-base + fee fixo do tipo.
  const directCostBasis = input.compMode !== "CONTRACTOR_FEE";
  const phasePcts = PAYMENT_PLANS[input.paymentPlan] ?? PAYMENT_PLANS.STANDARD;

  // ── 1. Unidades: valores ajustados pelo cenário + cronograma ──
  const units: SimUnitResult[] = input.units.map((u, i) => {
    const s = schedule(u, i, input);
    const adjLot = u.lotCost * (1 + sc.lotCostBufferPct / 100);
    // Performance/promote: custo próprio do local; contractor: custo-base + fee do tipo.
    const baseBuild = directCostBasis ? u.costPerformance : u.costContractor + u.contractorFee;
    const adjBuild = baseBuild * (1 + sc.constructionCostBufferPct / 100);
    const adjSaleGross = u.salePrice * (1 + sc.salePriceBufferPct / 100);
    const adjSaleNet = adjSaleGross * (1 - closingFee);
    return {
      ...u,
      tReq: s.tReq,
      tLotClose: s.tLotClose,
      tPermitOk: s.tPermitOk,
      tBuildStart: s.tBuildStart,
      tCO: s.tCO,
      tCashIn: s.tCashIn,
      adjLot: round2(adjLot),
      adjBuild: round2(adjBuild),
      adjSaleNet: round2(adjSaleNet),
      bankEligible: 0,
      profit: 0,
    };
  });

  // ── 2. Banco: sizing por unidade e fees upfront ──
  const bank = input.fundingMode === "BANK" ? input.bank : null;
  let committed = 0;
  if (bank) {
    for (const u of units) {
      const ltcCap =
        (bank.ltcBuildPct / 100) * u.adjBuild +
        (bank.financeLand ? (bank.ltcLandPct / 100) * u.adjLot : 0);
      const arv = u.salePrice * (1 + sc.salePriceBufferPct / 100) * (1 - bank.haircutPct / 100);
      const ltvCap = (bank.ltvPct / 100) * arv;
      u.bankEligible = round2(
        Math.max(0, Math.min(ltcCap, ltvCap, bank.perUnitCap ?? Infinity)),
      );
      committed += u.bankEligible;
    }
  }
  // Fees de closing itemizados (% do comprometido + fixos + customizados; crédito = negativo).
  const upfrontFees = bank
    ? round2(
        (committed *
          (bank.closingFeePct + bank.originationPct + bank.brokerPct + bank.titleEscrowPct)) /
          100 +
          bank.originationFlat +
          bank.processingFee +
          bank.budgetReviewFee +
          bank.appraisalFee +
          bank.legalFee +
          bank.customFees
            .filter((f) => f.timing === "CLOSING")
            .reduce(
              (s, f) => s + (f.kind === "PCT_COMMITTED" ? (committed * f.amount) / 100 : f.amount),
              0,
            ),
      )
    : 0;
  // Closing do loan: o banco autoriza quando X% dos permits estão emitidos (ceil) — ex.:
  // 10 casas a 80% → o 8º permit libera o closing. Antes disso, nada de draw nem juro.
  let loanClosingDay = 0;
  if (bank) {
    const permitDays = units.map((u) => u.tPermitOk).sort((a, b) => a - b);
    const k = Math.min(
      permitDays.length,
      Math.max(1, Math.ceil((bank.closingPermitPct / 100) * permitDays.length)),
    );
    loanClosingDay = permitDays[k - 1];
  }

  // ── 3. Fluxos do projeto (lado owner/pool) + rastreio do saldo do banco ──
  // No modo BANK, o banco cobre o custo de obra até o elegível (owner-first no equity da
  // unidade); draws antes do closing são pagos pelo owner e reembolsados? Não — como no
  // mock, draws antes do closing são empurrados para depois dele.
  const flows: Flow[] = [];
  const bankDraws: Array<{ day: number; amount: number; label: string }> = [];

  let perfFeeTotal = 0;
  let contractorFeeTotal = 0;
  let totalProfitBase = 0;

  for (const u of units) {
    // Lote: EMD + closing (owner sempre paga o lote, salvo financeLand — aí o banco cobre
    // a fração no draw do closing do lote).
    const lotBankShare = bank?.financeLand ? Math.min((bank.ltcLandPct / 100) * u.adjLot, u.bankEligible) : 0;
    flows.push({
      day: u.tReq,
      amount: -round2(u.adjLot * emd),
      label: `Lote • EMD ${Math.round(emd * 100)}% • ${u.label}`,
      kind: "LOT",
    });
    const lotBalance = u.adjLot * (1 - emd);
    if (lotBankShare > 0) {
      const ownerPart = Math.max(0, lotBalance - lotBankShare);
      if (ownerPart > 0)
        flows.push({ day: u.tLotClose, amount: -round2(ownerPart), label: `Lote • closing (equity) • ${u.label}`, kind: "LOT" });
      bankDraws.push({ day: Math.max(u.tLotClose, loanClosingDay + 1), amount: round2(Math.min(lotBankShare, lotBalance)), label: `Lote • closing (draw) • ${u.label}` });
    } else {
      flows.push({ day: u.tLotClose, amount: -round2(lotBalance), label: `Lote • closing • ${u.label}`, kind: "LOT" });
    }

    // Obra em 6 fases: equity da unidade primeiro, depois draws do banco.
    const buildBankCap = Math.max(0, u.bankEligible - lotBankShare);
    let ownerEquityLeft = Math.max(0, u.adjBuild - buildBankCap);
    let bankLeft = Math.min(u.adjBuild, buildBankCap);
    const days = phaseDays({
      tPermitApp: input.parallelPermit ? u.tReq : u.tLotClose,
      tPermitOk: u.tPermitOk,
      tBuildStart: u.tBuildStart,
      tCO: u.tCO,
      buildDays: u.tCO - u.tBuildStart,
      tReq: u.tReq,
      tLotClose: u.tLotClose,
      tCashIn: u.tCashIn,
    });
    phasePcts.forEach((pct, pi) => {
      let amt = u.adjBuild * pct;
      const label = `Fase ${pi + 1} • ${PHASE_NAMES[pi]} • ${Math.round(pct * 100)}% • ${u.label}`;
      if (!bank) {
        flows.push({ day: days[pi], amount: -round2(amt), label, kind: "PHASE" });
        return;
      }
      const fromOwner = Math.min(amt, ownerEquityLeft);
      if (fromOwner > 0) {
        flows.push({ day: days[pi], amount: -round2(fromOwner), label: `${label} (equity)`, kind: "PHASE" });
        ownerEquityLeft -= fromOwner;
        amt -= fromOwner;
      }
      if (amt > 0 && bankLeft > 0) {
        const fromBank = Math.min(amt, bankLeft);
        bankDraws.push({ day: Math.max(days[pi], loanClosingDay + 1), amount: round2(fromBank), label: `${label} (draw)` });
        bankLeft -= fromBank;
        amt -= fromBank;
      }
      if (amt > 1e-6) flows.push({ day: days[pi], amount: -round2(amt), label: `${label} (excedente)`, kind: "PHASE" });
    });

    // Contingência: reservada no início da obra, devolvida (não usada) na venda.
    const contingency = round2((u.adjLot + u.adjBuild) * (sc.contingencyReservePct / 100));
    if (contingency > 0) {
      flows.push({ day: u.tBuildStart, amount: -contingency, label: `Contingency reserve ${sc.contingencyReservePct}% • ${u.label}`, kind: "CONTINGENCY" });
      flows.push({ day: u.tCashIn, amount: contingency, label: `Contingency devolvida • ${u.label}`, kind: "CONTINGENCY" });
    }

    if (input.compMode === "CONTRACTOR_FEE") contractorFeeTotal += u.contractorFee;

    // Venda + performance fee (35% do lucro da casa, antes do split — sai como custo).
    const profitBase = u.adjSaleNet - u.adjLot - u.adjBuild;
    totalProfitBase += profitBase;
    flows.push({ day: u.tCashIn, amount: u.adjSaleNet, label: `Venda • ${u.label}`, kind: "SALE" });
    if (perfOn && input.perfTiming === "PER_SALE") {
      const perf = round2(Math.max(0, profitBase * input.perfPct));
      perfFeeTotal += perf;
      u.profit = round2(profitBase - perf);
      if (perf > 0)
        flows.push({ day: u.tCashIn + 5, amount: -perf, label: `Performance 4U ${Math.round(input.perfPct * 100)}% • ${u.label}`, kind: "PERF_FEE" });
    } else {
      u.profit = round2(profitBase);
    }
  }

  const lastSaleDay = Math.max(...units.map((u) => u.tCashIn));
  if (perfOn && input.perfTiming === "PROJECT_COMPLETION") {
    const perf = round2(Math.max(0, totalProfitBase * input.perfPct));
    perfFeeTotal = perf;
    if (perf > 0)
      flows.push({ day: lastSaleDay + 5, amount: -perf, label: `Performance 4U ${Math.round(input.perfPct * 100)}% (project completion)`, kind: "PERF_FEE" });
    // distribui o perf proporcionalmente no lucro por casa (informativo)
    for (const u of units) {
      const base = u.adjSaleNet - u.adjLot - u.adjBuild;
      u.profit = round2(base - Math.max(0, base) * (totalProfitBase > 0 ? input.perfPct : 0));
    }
  }

  // ── 4. Banco: reserve, juros, fees e payoffs (mecânica validada no loan 77959/BC) ──
  let bankInterestTotal = 0; // juro + custos mensais efetivamente cobrados
  let reserveFunded = 0;
  let reserveUnused = 0;
  let extensionFee = 0;
  if (bank) {
    const apr = bank.effectiveAprPct;
    const perDrawCustom = bank.customFees
      .filter((f) => f.timing === "PER_DRAW" && f.kind === "FLAT")
      .reduce((s, f) => s + f.amount, 0);
    const perBatchCustom = bank.customFees
      .filter((f) => f.timing === "PER_DRAW_BATCH" && f.kind === "FLAT")
      .reduce((s, f) => s + f.amount, 0);
    const monthlyCustom = bank.customFees
      .filter((f) => f.timing === "MONTHLY" && f.kind === "FLAT")
      .reduce((s, f) => s + f.amount, 0);
    const perPayoffFlat = bank.customFees
      .filter((f) => f.timing === "PER_PAYOFF" && f.kind === "FLAT")
      .reduce((s, f) => s + f.amount, 0);
    const perPayoffPct = bank.customFees
      .filter((f) => f.timing === "PER_PAYOFF" && f.kind === "PCT_PAYOFF")
      .reduce((s, f) => s + f.amount, 0);
    const finalCustom = bank.customFees
      .filter((f) => f.timing === "FINAL")
      .reduce((s, f) => s + (f.kind === "PCT_COMMITTED" ? (committed * f.amount) / 100 : f.amount), 0);

    // Reserve dimensionada como o banco faz: meses de juro sobre o COMPROMETIDO,
    // financiada (capitaliza no saldo) no closing. No 77959: 1.981.564 × 9% ÷ 12 × 6 ≈ 89.150 ✓
    reserveFunded = bank.hasInterestReserve
      ? round2(((committed * apr) / 100 / 12) * bank.reserveMonths)
      : 0;

    // fees upfront: financiados capitalizam; senão saem do caixa no closing
    if (!bank.feesFinanced && Math.abs(upfrontFees) > 0.01)
      flows.push({ day: loanClosingDay, amount: -upfrontFees, label: "Fees de closing do loan (não financiados)", kind: "BANK_FEE" });

    type BankEvt = { day: number; amount: number; label: string; isDraw?: boolean };
    const bevts: BankEvt[] = [
      ...(bank.feesFinanced ? [{ day: loanClosingDay, amount: upfrontFees, label: "Fees de closing (capitalizados)" }] : []),
      ...(reserveFunded > 0 ? [{ day: loanClosingDay, amount: reserveFunded, label: "Interest reserve (financiada)" }] : []),
      ...bankDraws.map((d) => ({ ...d, isDraw: true })),
    ].sort((a, b) => a.day - b.day);
    const sales = units
      .map((u) => ({ day: u.tCashIn, net: u.adjSaleNet, label: u.label }))
      .sort((a, b) => a.day - b.day);
    const termDay = loanClosingDay + bank.termMonths * 30;

    let bal = 0;
    let reserveLeft = reserveFunded;
    let cursor = loanClosingDay;
    let bi = 0;
    let si = 0;
    const horizon = lastSaleDay + 30;
    for (let day = loanClosingDay; day <= horizon; day++) {
      // draws do dia: fees por draw + fee por LOTE de draws (ex.: ACH) capitalizam no saldo
      let drawsToday = 0;
      while (bi < bevts.length && bevts[bi].day <= day) {
        const e = bevts[bi++];
        bal += e.amount;
        if (e.isDraw) {
          drawsToday += 1;
          bal += bank.inspectionFeePerDraw + bank.drawProcessingFee + perDrawCustom;
        }
      }
      if (drawsToday > 0) bal += bank.achFeePerBatch + perBatchCustom;

      // juros + custos mensais a cada 30 dias. Base: sacado (non-Dutch) ou comprometido
      // (Dutch). A reserve consome o custo do mês SEM compor no saldo; esgotada, o custo
      // vira aporte do pool.
      if (day > loanClosingDay && (day - loanClosingDay) % 30 === 0 && bal > 0) {
        const base = bank.interestBasis === "COMMITTED" ? committed : bal;
        const monthCost = round2((base * apr) / 100 / 12 + bank.servicingMonthly + monthlyCustom);
        bankInterestTotal += monthCost;
        if (reserveLeft >= monthCost) {
          reserveLeft = round2(reserveLeft - monthCost);
        } else {
          const short = round2(monthCost - reserveLeft);
          reserveLeft = 0;
          flows.push({ day, amount: -short, label: `Juros do loan (mês ${Math.round((day - loanClosingDay) / 30)})`, kind: "BANK_INTEREST" });
        }
      }

      // extension fee no fim do term (só cenário Conservador): deve >50% do comprometido →
      // % sobre TODO o financiado; senão, % só sobre o saldo. Capitaliza.
      if (bank.applyExtensionFee && extensionFee === 0 && day === termDay && bal > 0.01) {
        extensionFee = round2(
          bal > committed * 0.5 ? (committed * bank.extensionFeePct) / 100 : (bal * bank.extensionFeePct) / 100,
        );
        bal += extensionFee;
      }

      // payoffs nas vendas
      while (si < sales.length && sales[si].day <= day) {
        const isLast = si === sales.length - 1;
        const s = sales[si++];
        // reconveyance + fees por payoff capitalizam antes da quitação
        bal += bank.reconveyanceFee + perPayoffFlat;
        if (isLast) {
          // reconciliação final: devolve a reserve não usada (crédito no saldo) + fees finais
          reserveUnused = reserveLeft;
          bal = round2(bal - reserveLeft + finalCustom);
          reserveLeft = 0;
        }
        const cap =
          !isLast && bank.releaseMode === "SWEEP_PCT_LAST_FULL"
            ? (s.net * bank.sweepPct) / 100
            : s.net;
        let pay = round2(Math.max(0, Math.min(bal, cap)));
        if (perPayoffPct > 0 && pay > 0) {
          const exit = round2((pay * perPayoffPct) / 100);
          bal += exit;
          pay = round2(Math.max(0, Math.min(bal, cap)));
        }
        if (pay > 0) {
          bal = round2(bal - pay);
          flows.push({ day: s.day, amount: -pay, label: `Payoff do banco${isLast ? " (quitação + reconciliação da reserve)" : ""} • ${s.label}`, kind: "BANK_PAYOFF" });
        }
      }
      cursor = day;
    }
    if (bal > 0.01) {
      // saldo residual além do que as vendas cobriram — quitado com caixa do pool
      flows.push({ day: cursor, amount: -round2(bal), label: "Quitação final do loan (residual)", kind: "BANK_PAYOFF" });
    } else if (bal < -0.01) {
      // crédito do banco (ex.: reserve devolvida maior que o saldo restante)
      flows.push({ day: cursor, amount: -round2(bal), label: "Reconciliação final — devolução do banco", kind: "BANK_PAYOFF" });
    }
  }

  // ── 5. Ledger do investidor: JIT com aportes múltiplos de $1.000 ──
  // No mesmo dia, entradas processam ANTES das saídas (a venda liquida o payoff do banco no
  // mesmo dia) — senão o motor injeta aporte-fantasma para cobrir uma saída já financiada.
  flows.sort((a, b) => a.day - b.day || b.amount - a.amount);
  // pior déficit futuro acumulado a partir de i (para saques antecipados seguros)
  const n = flows.length;
  const futureMinNeed = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let run = 0;
    let worst = 0;
    for (let j = i; j < n; j++) {
      run += flows[j].amount;
      if (run < worst) worst = run;
    }
    futureMinNeed[i] = -worst;
  }

  const events: SimEvent[] = [];
  let cash = 0;
  let invested = 0;
  let bankBalance = 0;
  let totalInjected = 0;
  let totalReturned = 0;
  let peak = 0;
  const investorFlows: Array<{ day: number; amount: number }> = [];

  const push = (day: number, amount: number, label: string, kind: SimEvent["kind"]) => {
    cash = round2(cash + amount);
    events.push({ day, amount: round2(amount), label, kind, cash, invested, bankBalance });
  };

  flows.forEach((f, i) => {
    if (cash + f.amount < -1e-9) {
      const inj = round2(-(cash + f.amount)); // JIT exato, como no mock
      invested = round2(invested + inj);
      totalInjected += inj;
      peak = Math.max(peak, invested);
      investorFlows.push({ day: f.day, amount: -inj });
      push(f.day, inj, "Aporte do investidor (JIT)", "INJECTION");
    }
    // rastreia saldo do banco para exibição
    if (f.kind === "BANK_PAYOFF") bankBalance = round2(Math.max(0, bankBalance + f.amount));
    push(f.day, f.amount, f.label, f.kind);
    const required = futureMinNeed[i + 1] ?? 0;
    const surplus = cash - required;
    if (surplus > 0.01) {
      invested = round2(Math.max(0, invested - surplus));
      totalReturned += surplus;
      investorFlows.push({ day: f.day, amount: surplus });
      push(f.day, -surplus, "Retorno ao investidor", "RETURN");
    }
  });
  const finalDay = flows[n - 1]?.day ?? 0;
  if (cash > 0.01) {
    totalReturned += cash;
    investorFlows.push({ day: finalDay, amount: cash });
    push(finalDay, -cash, "Distribuição final", "RETURN");
  }

  // ── 5b. Promote (waterfall) — pago na conclusão, deduzido dos retornos do dia final.
  // Tiers sobre o retorno ANUALIZADO do investidor: TWC = Σ(capital em risco × anos);
  // lucro equivalente a r% a.a. = r% × TWC; cada faixa entrega promotePct à 4U. Abaixo do
  // primeiro hurdle (pref), a 4U não recebe nada.
  if (input.compMode === "PROMOTE" && input.promoteTiers?.length) {
    let twc = 0; // dólar-anos
    let inv = 0;
    let prevDay = investorFlows[0]?.day ?? 0;
    for (const f of investorFlows) {
      twc += (inv * (f.day - prevDay)) / 365;
      prevDay = f.day;
      inv = Math.max(0, inv - f.amount); // injeção (negativa) aumenta; retorno reduz
    }
    const profitBefore = round2(totalReturned - totalInjected);
    let fee = 0;
    if (profitBefore > 0 && twc > 0) {
      let remaining = profitBefore;
      let prevLimit = 0;
      for (const t of input.promoteTiers) {
        if (remaining <= 0) break;
        const limit = t.hurdlePct == null ? Infinity : (t.hurdlePct / 100) * twc;
        const band = Math.min(remaining, Math.max(0, limit - prevLimit));
        fee += (band * t.promotePct) / 100;
        remaining -= band;
        if (limit !== Infinity) prevLimit = Math.max(prevLimit, limit);
      }
      fee = round2(fee);
    }
    if (fee > 0) {
      // deduz dos RETURNs do dia final (é de onde o promote sai na prática)
      let remainingFee = fee;
      for (let i = events.length - 1; i >= 0 && remainingFee > 0.005; i--) {
        const ev = events[i];
        if (ev.kind !== "RETURN" || ev.day !== finalDay) continue;
        const take = round2(Math.min(remainingFee, -ev.amount));
        ev.amount = round2(ev.amount + take);
        remainingFee = round2(remainingFee - take);
      }
      // ajusta investorFlows: consome dos retornos positivos do dia final, de trás p/ frente
      let flowFee = round2(fee - remainingFee);
      for (let i = investorFlows.length - 1; i >= 0 && flowFee > 0.005; i--) {
        const f = investorFlows[i];
        if (f.day !== finalDay || f.amount <= 0) continue;
        const take = round2(Math.min(flowFee, f.amount));
        f.amount = round2(f.amount - take);
        flowFee = round2(flowFee - take);
      }
      const feeApplied = round2(fee - remainingFee);
      if (feeApplied > 0) {
        perfFeeTotal = feeApplied;
        totalReturned = round2(totalReturned - feeApplied);
        events.push({
          day: finalDay,
          amount: -feeApplied,
          label: "Promote 4U (waterfall)",
          kind: "PERF_FEE",
          cash: 0,
          invested: 0,
          bankBalance: 0,
        });
      }
    }
  }

  // ── 6. KPIs e resumo mensal ──
  const irr = xirr(investorFlows.map((f) => ({ day: f.day, amount: f.amount })));
  const monthlyMap = new Map<number, { inflow: number; outflow: number }>();
  for (const e of events) {
    if (e.kind !== "INJECTION" && e.kind !== "RETURN") continue;
    const m = Math.floor(e.day / 30) + 1;
    const cur = monthlyMap.get(m) ?? { inflow: 0, outflow: 0 };
    if (e.kind === "INJECTION") cur.inflow += e.amount;
    else cur.outflow += -e.amount;
    monthlyMap.set(m, cur);
  }
  let running = 0;
  const monthly = [...monthlyMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month, v]) => {
      running = round2(running + v.inflow - v.outflow);
      return { month, inflow: round2(v.inflow), outflow: round2(v.outflow), balance: running };
    });

  const totalCost = units.reduce((s, u) => s + u.adjLot + u.adjBuild, 0);

  return {
    kpis: {
      totalInvested: round2(totalInjected),
      totalReturned: round2(totalReturned),
      profit: round2(totalReturned - totalInjected),
      irrAnnual: irr,
      irrMonthly: irr == null ? null : Math.pow(1 + irr, 1 / 12) - 1,
      equityMultiple: totalInjected > 0 ? round2(totalReturned / totalInjected) : null,
      peakCapital: round2(peak),
      durationDays: Math.max(...events.map((e) => e.day), 0),
      perfFeeTotal: round2(perfFeeTotal),
      contractorFeeTotal: round2(contractorFeeTotal),
      bankCommitted: round2(committed),
      bankUpfrontFees: upfrontFees,
      bankInterestTotal: round2(bankInterestTotal),
      bankReserveFunded: round2(reserveFunded),
      bankReserveUnused: round2(reserveUnused),
      bankExtensionFee: round2(extensionFee),
      equityGateAmount: round2((input.equityGatePct ?? 0) * totalCost),
    },
    events,
    monthly,
    units,
  };
}
