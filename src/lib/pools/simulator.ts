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
  landAcquisitionDays: number; // escrow do LOTE: caução → closing (padrão de mercado 15d)
  saleClosingDays: number; // closing da VENDA: contrato do comprador → dinheiro no caixa (~45d)
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
  reserveInEnvelope: boolean; // reserve financiada consome o comprometido (estilo BC)
  overfundingMode: "NONE" | "REFUND_AT_CLOSING" | "REFUND_IN_DRAWS"; // excedente: nada · cheque no closing+15 · diluído nas medições
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
  costOpenBook: number; // custo real open book (por local) — modalidade custo + taxa flat
  contractorFee: number; // fee fixo do tipo (ou override do modelo)
  lotCost: number; // sempre o lotCostEstimate do location
  salePrice: number;
  // Esteira de ciclos (equity): 1 = cesta inicial; k≥2 = casa ENGATILHADA — lote+F1
  // antecipados, obra começa no dia seguinte à venda-gatilho do ciclo anterior
  cycle: number;
};

export type PromoteTier = {
  hurdlePct: number | null; // retorno a.a. sobre o capital médio em risco; null = acima do último
  promotePct: number; // % da faixa que vai para a 4U
};

export type SimInput = {
  fundingMode: "EQUITY" | "BANK";
  // aporte único de 100% em D+0 (mínimo p/ nunca faltar caixa) em vez do JIT — mostra o
  // impacto do capital parado na TIR; retornos seguem a regra normal (excedente ao futuro)
  upfrontFunding: boolean;
  compMode: "CONTRACTOR_FEE" | "PERFORMANCE" | "PROMOTE" | "OPEN_BOOK";
  // OPEN_BOOK: taxa flat de lucro por casa p/ a 4U — entra no custo da casa (obra + fee),
  // paga pelos gatilhos do plano de desembolso; promote opcional por cima (tiers preenchidos)
  flatFeePerHouse: number;
  perfPct: number; // fração (0.35) — modo PERFORMANCE
  perfTiming: "PER_SALE" | "PROJECT_COMPLETION";
  promoteTiers: PromoteTier[] | null; // modo PROMOTE (pago na conclusão)
  paymentPlan: "STANDARD" | "LIGHT_START" | "PARTNER"; // 10/30/20/20/15/5 · 10/15/25/25/20/5 · 10/10/25/25/25/5
  equityGatePct: number; // fração
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
    | "BANK_DRAW" // dinheiro do banco ENTRANDO no caixa (pareado com o pagamento da obra)
    | "BANK_CTC" // cash to closing: + cheque do excedente do loan · − investidor completa no closing
    | "BANK_FEE"
    | "BANK_RESERVE"
    | "BANK_INTEREST"
    | "BANK_PAYOFF";
  bankAmount?: number; // delta no saldo devedor do loan causado pelo evento
  // categoria do custo bancário (p/ o quadro mensal) e valor informativo (juro pago da
  // reserve não mexe em caixa nem saldo — o custo do mês vai aqui)
  bankCat?: "CLOSING" | "RESERVE" | "INTEREST" | "DRAW_FEES" | "PAYOFF_FEES" | "EXTENSION";
  infoAmount?: number;
  cash: number; // saldo do projeto após o evento
  invested: number; // capital do investidor em risco após o evento
  bankBalance: number; // saldo devedor do banco após o evento
};

export type SimUnitResult = SimUnitInput & {
  tReq: number; // início da busca do lote
  tEmd: number; // caução (lote sob contrato)
  tLotClose: number;
  tPermitOk: number;
  tBuildStart: number;
  tCO: number;
  tCashIn: number;
  adjLot: number;
  adjBuild: number;
  adjSaleNet: number; // venda ajustada líquida de closing fee
  bankEligible: number;
  bankLtcBasis: number; // orçamento do banco: contractor + fee + lote (ajustados)
  bankLtcCap: number; // LTC% × base
  bankLtvCap: number; // LTV% × ARV (com haircut)
  profit: number;
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
    perfFeeTotal: number; // remuneração da 4U (performance) — builder
    promoteTotal: number; // waterfall/promote da VIXUS (Development Manager) — 14/07
    contractorFeeTotal: number;
    bankCommitted: number;
    bankUpfrontFees: number;
    bankInterestTotal: number;
    bankOtherFees: number; // fees por draw/lote/payoff/exit/finais que capitalizam no saldo
    bankReserveFunded: number;
    bankReserveUnused: number;
    bankExtensionFee: number;
    cashToClosing: number; // + excedente devolvido em cheque · − investidor paga no closing
    equityGateAmount: number;
    loanClosingDay: number | null; // dia do closing do loan (null = equity) — p/ fases/term
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

type Flow = {
  day: number;
  amount: number;
  label: string;
  kind: SimEvent["kind"];
  bankAmount?: number; // delta no saldo devedor do loan (capitalizações têm amount 0)
  bankCat?: SimEvent["bankCat"];
  infoAmount?: number;
};

// Cronograma de uma unidade (forward, unidades espaçadas por unitGapDays).
// Como o mercado funciona (regra do Stefan, 13/07): busca do lote (lotLeadDays do
// location) → CAUÇÃO no contrato → escrow (landAcquisitionDays do cenário, ~15d) →
// closing do lote → permit CONTA A PARTIR DO PAGAMENTO → obra → CO → marketing
// (saleDays + absorção) → contrato do comprador → closing da venda (saleClosingDays,
// ~45d) → dinheiro no caixa.
function schedule(u: SimUnitInput, idx: number, input: SimInput) {
  const sc = input.scenario;
  const tReq = idx * input.unitGapDays; // início da BUSCA do lote (nada sai do caixa aqui)
  const tEmd = tReq + u.lotLeadDays; // lote achado, contrato assinado → caução
  const tLotClose = tEmd + sc.landAcquisitionDays;
  const tPermitOk = tLotClose + u.permitDays; // pagou o lote, inicia a contagem do permit
  const tBuildStart = tPermitOk;
  const buildDays = Math.max(30, Math.round((u.buildMonths + sc.constructionDurationBufferM) * 30));
  const tCO = tBuildStart + buildDays;
  // Absorção do cenário SOMA aos dias de venda do location (cada região tem seu prazo;
  // substituir melhorava umas e piorava outras — regra do Stefan 10/07). Vazio = +0.
  const saleDays = u.saleDays + Math.round((sc.salesAbsorptionMonths ?? 0) * 30);
  const tCashIn = tCO + saleDays + sc.saleClosingDays;
  const tPermitApp = tLotClose;
  return { tReq, tEmd, tLotClose, tPermitOk, tBuildStart, tCO, tCashIn, tPermitApp, buildDays };
}

// Planos de desembolso da obra (6 fases). LIGHT_START alivia o início: até o permit caem
// 25% (vs 40%) — exposição inicial ≈ lote + 25% da obra (+ juros estimados sem reserve).
// PARTNER (sócios): só 20% até o permit — aporte inicial mais leve, resto na obra.
const PHASE_NAMES = [
  "Permit application",
  "Permit issued",
  "Truss delivery",
  "Drywall installation",
  "Tile installation",
  "CO issued",
] as const;

export const PAYMENT_PLANS: Record<"STANDARD" | "LIGHT_START" | "PARTNER", number[]> = {
  STANDARD: [0.1, 0.3, 0.2, 0.2, 0.15, 0.05],
  LIGHT_START: [0.1, 0.15, 0.25, 0.25, 0.2, 0.05],
  PARTNER: [0.1, 0.1, 0.25, 0.25, 0.25, 0.05],
};

// Depois do closing, as PRIMEIRAS medições do banco levam ~15 dias — nenhum draw antes
// disso (regra do Stefan, 10/07; empurra cronograma e juros para frente).
const DRAW_START_LAG_DAYS = 15;

// Casa ENGATILHADA (ciclo k≥2): conta de chegada de trás p/ frente — lote comprado e
// permit aplicado cedo o bastante para o permit estar EMITIDO na venda-gatilho; a obra
// começa no dia seguinte à venda. Se não der tempo (gatilho cedo demais), compra em D+0
// e a obra espera o permit.
function scheduleQueued(u: SimUnitInput, triggerDay: number, input: SimInput) {
  const sc = input.scenario;
  const idealReq = triggerDay + 1 - u.permitDays - sc.landAcquisitionDays - u.lotLeadDays;
  const tReq = Math.max(0, idealReq); // início da busca (conta de chegada)
  const tEmd = tReq + u.lotLeadDays; // caução no contrato do lote
  const tLotClose = tEmd + sc.landAcquisitionDays;
  const tPermitOk = tLotClose + u.permitDays;
  const tBuildStart = Math.max(triggerDay + 1, tPermitOk);
  const buildDays = Math.max(30, Math.round((u.buildMonths + sc.constructionDurationBufferM) * 30));
  const tCO = tBuildStart + buildDays;
  const saleDays = u.saleDays + Math.round((sc.salesAbsorptionMonths ?? 0) * 30);
  const tCashIn = tCO + saleDays + sc.saleClosingDays;
  const tPermitApp = tLotClose; // F1 ANTECIPADA pelo cliente (junto com o lote)
  return { tReq, tEmd, tLotClose, tPermitOk, tBuildStart, tCO, tCashIn, tPermitApp, buildDays };
}

function phaseDays(s: ReturnType<typeof schedule> & { f2Day?: number }): number[] {
  return [
    s.tPermitApp,
    // F2 (permit issued): na casa engatilhada é paga COM o dinheiro da venda-gatilho,
    // no início da obra — nunca antecipada (regra do Stefan)
    s.f2Day ?? s.tPermitOk + 1,
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
  const phasePcts = PAYMENT_PLANS[input.paymentPlan] ?? PAYMENT_PLANS.STANDARD;

  // ── 1. Unidades: valores ajustados pelo cenário + cronograma (esteira de ciclos) ──
  // Ciclo 1 agenda como sempre (gap do cenário entre casas). Casa do ciclo k≥2 é
  // engatilhada 1:1 pelas vendas do ciclo k−1, na ordem; casas EXTRAS (cesta crescendo
  // 3→4→5…) usam a última venda — são financiadas pelo lucro acumulado. Vendeu uma,
  // começa uma (obra no dia seguinte à venda-gatilho).
  const units: SimUnitResult[] = input.units.map((u) => {
    const adjLot = u.lotCost * (1 + sc.lotCostBufferPct / 100);
    // Performance/promote: custo próprio do local; contractor: custo-base + fee do tipo;
    // open book: custo real + taxa flat (a 4U é paga DENTRO do custo, pelos gatilhos).
    const baseBuild =
      input.compMode === "CONTRACTOR_FEE"
        ? u.costContractor + u.contractorFee
        : input.compMode === "OPEN_BOOK"
          ? u.costOpenBook + input.flatFeePerHouse
          : u.costPerformance;
    const adjBuild = baseBuild * (1 + sc.constructionCostBufferPct / 100);
    const adjSaleGross = u.salePrice * (1 + sc.salePriceBufferPct / 100);
    const adjSaleNet = adjSaleGross * (1 - closingFee);
    return {
      ...u,
      cycle: u.cycle || 1,
      tReq: 0,
      tEmd: 0,
      tLotClose: 0,
      tPermitOk: 0,
      tBuildStart: 0,
      tCO: 0,
      tCashIn: 0,
      adjLot: round2(adjLot),
      adjBuild: round2(adjBuild),
      adjSaleNet: round2(adjSaleNet),
      bankEligible: 0,
      bankLtcBasis: 0,
      bankLtcCap: 0,
      bankLtvCap: 0,
      profit: 0,
    };
  });
  {
    const cyclesSorted = [...new Set(units.map((u) => u.cycle))].sort((a, b) => a - b);
    let prevSales: number[] = [];
    for (const [ci, c] of cyclesSorted.entries()) {
      const group = units.filter((u) => u.cycle === c);
      group.forEach((u, j) => {
        const sch =
          ci === 0
            ? schedule(u, j, input)
            : scheduleQueued(u, prevSales[Math.min(j, prevSales.length - 1)], input);
        u.tReq = sch.tReq;
        u.tEmd = sch.tEmd;
        u.tLotClose = sch.tLotClose;
        u.tPermitOk = sch.tPermitOk;
        u.tBuildStart = sch.tBuildStart;
        u.tCO = sch.tCO;
        u.tCashIn = sch.tCashIn;
      });
      prevSales = group.map((u) => u.tCashIn).sort((a, b) => a - b);
    }
  }
  const firstCycle = Math.min(...units.map((u) => u.cycle));

  // ── 2. Banco: sizing por unidade e fees upfront ──
  // Base do LTC (regra do Stefan, 10/07): o ORÇAMENTO que o banco enxerga = custo
  // contractor + fee da obra + lote do location (valores ajustados pelo cenário) —
  // independente da modalidade interna (performance/open book). O banco desembolsa TUDO
  // que aprovar; o que passar do custo real volta ao cliente como reembolso (CTC).
  const bank = input.fundingMode === "BANK" ? input.bank : null;
  let committed = 0;
  if (bank) {
    for (const u of units) {
      // valores PUROS do catálogo: o banco dimensiona no orçamento/appraisal REAL —
      // os buffers de cenário são coisa interna e NÃO entram no sizing (regra do Stefan)
      u.bankLtcBasis = round2(u.costContractor + u.contractorFee + u.lotCost);
      u.bankLtcCap = round2((bank.ltcBuildPct / 100) * u.bankLtcBasis);
      const arv = u.salePrice * (1 - bank.haircutPct / 100);
      u.bankLtvCap = round2((bank.ltvPct / 100) * arv);
      // arredonda p/ BAIXO ao múltiplo de $5k: o banco aprova valor redondo e conservador
      // (ex.: cálculo 238k → aprova 235k — não quer se expor no quebrado)
      const rawEligible = Math.max(0, Math.min(u.bankLtcCap, u.bankLtvCap, bank.perUnitCap ?? Infinity));
      u.bankEligible = Math.floor(rawEligible / 5000) * 5000;
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
  // obraCost = parte do draw que paga a obra; amount > obraCost = excedente ao cliente
  const bankDraws: Array<{ day: number; amount: number; obraCost: number; label: string }> = [];

  // REFUND_IN_DRAWS (estilo BC, validado no 77959): o banco desembolsa o BUDGET CHEIO da
  // casa diluído nas medições — budget = aprovado − rateio de fees rolados + reserve (o
  // que consome o envelope). O excedente sobre a obra pinga no caixa a cada draw.
  const inDraws = bank?.overfundingMode === "REFUND_IN_DRAWS";
  const drawBudget = new Map<SimUnitResult, number>();
  if (bank && inDraws && committed > 0) {
    const reserveEst = bank.hasInterestReserve
      ? round2(((committed * bank.effectiveAprPct) / 100 / 12) * bank.reserveMonths)
      : 0;
    const pool = Math.max(
      0,
      round2(
        committed -
          (bank.feesFinanced ? upfrontFees : 0) -
          (bank.reserveInEnvelope ? reserveEst : 0),
      ),
    );
    let acc = 0;
    units.forEach((u, i) => {
      if (i === units.length - 1) drawBudget.set(u, round2(pool - acc));
      else {
        const b = round2((u.bankEligible / committed) * pool);
        drawBudget.set(u, b);
        acc = round2(acc + b);
      }
    });
  }

  let perfFeeTotal = 0;
  let promoteTotal = 0; // promote é da Vixus (developer), separado da 4U
  let contractorFeeTotal = 0;
  let totalProfitBase = 0;

  for (const u of units) {
    // Lote: EMD + closing (owner sempre paga o lote, salvo financeLand — aí o banco cobre
    // a fração no draw do closing do lote).
    const lotBankShare = bank?.financeLand ? Math.min((bank.ltcLandPct / 100) * u.adjLot, u.bankEligible) : 0;
    flows.push({
      // caução sai quando o lote está SOB CONTRATO (após a busca) — não em tReq
      day: u.tEmd,
      amount: -round2(u.adjLot * emd),
      label: `Lote • EMD ${Math.round(emd * 100)}% • ${u.label}`,
      kind: "LOT",
    });
    const lotBalance = u.adjLot * (1 - emd);
    if (lotBankShare > 0) {
      const ownerPart = Math.max(0, lotBalance - lotBankShare);
      if (ownerPart > 0)
        flows.push({ day: u.tLotClose, amount: -round2(ownerPart), label: `Lote • closing (equity) • ${u.label}`, kind: "LOT" });
      const lotDraw = round2(Math.min(lotBankShare, lotBalance));
      bankDraws.push({ day: Math.max(u.tLotClose, loanClosingDay + DRAW_START_LAG_DAYS), amount: lotDraw, obraCost: lotDraw, label: `Lote • closing (draw) • ${u.label}` });
    } else {
      flows.push({ day: u.tLotClose, amount: -round2(lotBalance), label: `Lote • closing • ${u.label}`, kind: "LOT" });
    }

    // Obra em 6 fases. Regras do banco (Stefan, 10/07):
    // - F1 (permit application) e F2 (permit issued) são SEMPRE do proprietário — banco
    //   NÃO paga permit (o closing só existe porque 80% dos permits saíram; as casas que
    //   faltam também pagam permit com equity);
    // - draws só a partir da F3, e as primeiras medições levam ~15 dias após o closing.
    const buildBankCap = Math.max(0, u.bankEligible - lotBankShare);
    const fundable = u.adjBuild * phasePcts.slice(2).reduce((s, p) => s + p, 0); // F3..F6
    let bankLeft = Math.min(fundable, buildBankCap);
    let ownerEquityLeft = Math.max(0, fundable - bankLeft); // equity-first dentro do financiável
    const isQueued = u.cycle > firstCycle;
    const days = phaseDays({
      tPermitApp: u.tLotClose, // permit só inicia após a compra do lote
      tPermitOk: u.tPermitOk,
      tBuildStart: u.tBuildStart,
      tCO: u.tCO,
      buildDays: u.tCO - u.tBuildStart,
      tReq: u.tReq,
      tEmd: u.tEmd,
      tLotClose: u.tLotClose,
      tCashIn: u.tCashIn,
      // casa engatilhada: F2 paga com o dinheiro da venda-gatilho, no início da obra
      ...(isQueued ? { f2Day: u.tBuildStart } : {}),
    });
    const sumBankPcts = phasePcts.slice(2).reduce((s2, p2) => s2 + p2, 0);
    let budgetAcc = 0;
    phasePcts.forEach((pct, pi) => {
      let amt = u.adjBuild * pct;
      const label = `Fase ${pi + 1} • ${PHASE_NAMES[pi]} • ${Math.round(pct * 100)}% • ${u.label}`;
      if (!bank || pi < 2) {
        flows.push({
          day: days[pi],
          amount: -round2(amt),
          label: bank && pi < 2 ? `${label} (equity — banco não paga permit)` : label,
          kind: "PHASE",
        });
        return;
      }
      if (inDraws) {
        // medição = fatia do BUDGET da casa (última fase fecha o resto ao centavo);
        // a obra real é paga no par do draw; a diferença é excedente ao cliente
        const budget = drawBudget.get(u) ?? 0;
        const isLast = pi === phasePcts.length - 1;
        const drawAmt = isLast
          ? round2(budget - budgetAcc)
          : round2(budget * (pct / sumBankPcts));
        budgetAcc = round2(budgetAcc + drawAmt);
        if (drawAmt > 0.005) {
          bankDraws.push({
            day: Math.max(days[pi], loanClosingDay + DRAW_START_LAG_DAYS),
            amount: drawAmt,
            obraCost: round2(amt),
            label: `${label} (draw)`,
          });
        } else {
          flows.push({ day: days[pi], amount: -round2(amt), label, kind: "PHASE" });
        }
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
        bankDraws.push({
          day: Math.max(days[pi], loanClosingDay + DRAW_START_LAG_DAYS),
          amount: round2(fromBank),
          obraCost: round2(fromBank),
          label: `${label} (draw)`,
        });
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
    // OPEN_BOOK: a taxa flat já saiu pelo custo (fases) — aqui só totaliza p/ o KPI da 4U
    if (input.compMode === "OPEN_BOOK") contractorFeeTotal += input.flatFeePerHouse;

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
  let bankOtherFees = 0; // fees por draw/lote/payoff/exit/finais (capitalizam no saldo)
  let cashToClosing = 0; // + cheque do excedente · − completação do investidor no closing
  let reserveFunded = 0;
  let reserveUnused = 0;
  let extensionFee = 0;
  if (bank) {
    const apr = bank.effectiveAprPct;
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
      flows.push({ day: loanClosingDay, amount: -upfrontFees, label: "Fees de closing do loan (não financiados)", kind: "BANK_FEE", bankCat: "CLOSING" });

    type BankEvt = { day: number; amount: number; obraCost: number; label: string; isDraw?: boolean };
    const bevts: BankEvt[] = [
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
    // capitalização no saldo do loan SEM passar pelo caixa (amount 0 → só ledger/saldo)
    const cap = (
      day: number,
      delta: number,
      label: string,
      kind: SimEvent["kind"],
      bankCat?: SimEvent["bankCat"],
    ) => {
      bal = round2(bal + delta);
      flows.push({ day, amount: 0, bankAmount: round2(delta), label, kind, bankCat });
    };
    if (bank.feesFinanced && Math.abs(upfrontFees) > 0.01)
      cap(loanClosingDay, upfrontFees, "Fees de closing capitalizados no loan", "BANK_FEE", "CLOSING");
    if (reserveFunded > 0)
      cap(loanClosingDay, reserveFunded, `Interest reserve financiada (${bank.reserveMonths}m sobre o comprometido)`, "BANK_RESERVE", "RESERVE");

    // Cash to Closing (planilha Rolling Hills): o loan é um ENVELOPE —
    //   comprometido = fees rolados + reserve (se consome o envelope) + draws da obra + CTC.
    // CTC > 0 e banco devolve → CHEQUE único em closing+15 (capitaliza e paga juros);
    // CTC < 0 → o loan não cobre tudo: investidor completa em CASH no closing (abate o saldo).
    const plannedDrawsTotal = round2(bankDraws.reduce((s2, d) => s2 + d.amount, 0));
    const envelopeUse = round2(
      (bank.feesFinanced ? upfrontFees : 0) +
        (bank.reserveInEnvelope ? reserveFunded : 0) +
        plannedDrawsTotal,
    );
    cashToClosing = round2(committed - envelopeUse);
    if (cashToClosing > 0.01 && bank.overfundingMode !== "REFUND_AT_CLOSING") cashToClosing = 0;
    const ctcDay = cashToClosing > 0 ? loanClosingDay + DRAW_START_LAG_DAYS : loanClosingDay;
    if (cashToClosing > 0.01) {
      // cheque entra no caixa E no saldo devedor — juros correm sobre ele até o payoff
      flows.push({
        day: ctcDay,
        amount: cashToClosing,
        bankAmount: cashToClosing,
        label:
          "Excedente do loan — reembolso ao cliente pelos custos antecipados (cash to closing)",
        kind: "BANK_CTC",
      });
    } else if (cashToClosing < -0.01) {
      // investidor completa a diferença no closing; o cash abate o saldo capitalizado
      flows.push({
        day: ctcDay,
        amount: cashToClosing,
        bankAmount: cashToClosing,
        label: "Cash to close — loan não cobre fees + reserve + obra (investidor completa)",
        kind: "BANK_CTC",
      });
    }

    const horizon = lastSaleDay + 30;
    let ctcPending = Math.abs(cashToClosing) > 0.01 ? cashToClosing : 0;
    for (let day = loanClosingDay; day <= horizon; day++) {
      // CTC: cheque (closing+15) soma no saldo; completação do investidor (closing) abate
      if (ctcPending !== 0 && day >= ctcDay) {
        bal = round2(bal + ctcPending);
        ctcPending = 0;
      }
      // draws do dia: o dinheiro do banco ENTRA no caixa e SAI pagando a obra (par visível
      // no ledger); fees por draw + fee por LOTE (ex.: ACH) capitalizam no saldo
      let drawsToday = 0;
      while (bi < bevts.length && bevts[bi].day <= day) {
        const e = bevts[bi++];
        const baseLabel = e.label.replace(/ \(draw\)$/, "");
        bal = round2(bal + e.amount);
        const obraPart = round2(Math.min(e.amount, e.obraCost));
        const excess = round2(e.amount - obraPart);
        flows.push({
          day,
          amount: obraPart,
          bankAmount: obraPart,
          label: `Draw do banco • ${baseLabel}`,
          kind: "BANK_DRAW",
        });
        if (excess > 0.005)
          flows.push({
            day,
            amount: excess,
            bankAmount: excess,
            label: `Excedente da medição — reembolso ao cliente • ${baseLabel}`,
            kind: "BANK_DRAW",
          });
        flows.push({ day, amount: -e.obraCost, label: `Pagamento da obra • ${baseLabel}`, kind: "PHASE" });
        // fees do draw como LINHAS próprias, capitalizando no saldo (como no extrato do banco)
        if (bank.inspectionFeePerDraw > 0) {
          bankOtherFees += bank.inspectionFeePerDraw;
          cap(day, bank.inspectionFeePerDraw, `Inspection fee do draw • ${baseLabel}`, "BANK_FEE", "DRAW_FEES");
        }
        if (bank.drawProcessingFee > 0) {
          bankOtherFees += bank.drawProcessingFee;
          cap(day, bank.drawProcessingFee, `Draw processing fee • ${baseLabel}`, "BANK_FEE", "DRAW_FEES");
        }
        for (const cf of bank.customFees.filter((f) => f.timing === "PER_DRAW" && f.kind === "FLAT")) {
          bankOtherFees += cf.amount;
          cap(day, cf.amount, `${cf.name} (por draw) • ${baseLabel}`, "BANK_FEE", "DRAW_FEES");
        }
        drawsToday += 1;
      }
      if (drawsToday > 0 && bank.achFeePerBatch + perBatchCustom > 0) {
        bankOtherFees += bank.achFeePerBatch + perBatchCustom;
        cap(day, bank.achFeePerBatch + perBatchCustom, "Fee por lote de draws (ACH)", "BANK_FEE", "DRAW_FEES");
      }

      // juros + custos mensais a cada 30 dias. Base: sacado (non-Dutch) ou comprometido
      // (Dutch). A reserve consome o custo do mês SEM compor no saldo; esgotada, o custo
      // vira aporte do pool.
      if (day > loanClosingDay && (day - loanClosingDay) % 30 === 0 && bal > 0) {
        const month = Math.round((day - loanClosingDay) / 30);
        const base = bank.interestBasis === "COMMITTED" ? committed : bal;
        const monthCost = round2((base * apr) / 100 / 12 + bank.servicingMonthly + monthlyCustom);
        bankInterestTotal += monthCost;
        if (reserveLeft >= monthCost) {
          reserveLeft = round2(reserveLeft - monthCost);
          flows.push({
            day,
            amount: 0,
            label: `Juro do mês ${month} — $${monthCost.toLocaleString("en-US")} pago da reserve (restam $${reserveLeft.toLocaleString("en-US")})`,
            kind: "BANK_INTEREST",
            bankCat: "INTEREST",
            infoAmount: monthCost,
          });
        } else {
          const short = round2(monthCost - reserveLeft);
          const fromReserve = reserveLeft;
          reserveLeft = 0;
          flows.push({
            day,
            amount: -short,
            label: `Juros do loan (mês ${month})${fromReserve > 0 ? ` — reserve cobriu $${fromReserve.toLocaleString("en-US")}` : ""}`,
            kind: "BANK_INTEREST",
            bankCat: "INTEREST",
            infoAmount: monthCost,
          });
        }
      }

      // extension fee no fim do term (só cenário Conservador): deve >50% do comprometido →
      // % sobre TODO o financiado; senão, % só sobre o saldo. Capitaliza.
      if (bank.applyExtensionFee && extensionFee === 0 && day === termDay && bal > 0.01) {
        extensionFee = round2(
          bal > committed * 0.5 ? (committed * bank.extensionFeePct) / 100 : (bal * bank.extensionFeePct) / 100,
        );
        cap(day, extensionFee, `Extension fee ${bank.extensionFeePct}% (fim do term de ${bank.termMonths}m)`, "BANK_FEE", "EXTENSION");
      }

      // payoffs nas vendas
      while (si < sales.length && sales[si].day <= day) {
        const isLast = si === sales.length - 1;
        const s = sales[si++];
        // reconveyance + fees por payoff capitalizam antes da quitação
        if (bank.reconveyanceFee + perPayoffFlat > 0) {
          bankOtherFees += bank.reconveyanceFee + perPayoffFlat;
          cap(s.day, bank.reconveyanceFee + perPayoffFlat, `Reconveyance/fees do payoff • ${s.label}`, "BANK_FEE", "PAYOFF_FEES");
        }
        if (isLast) {
          // reconciliação final: devolve a reserve não usada (crédito no saldo) + fees finais
          reserveUnused = reserveLeft;
          bankOtherFees += finalCustom;
          if (reserveLeft > 0.005 || Math.abs(finalCustom) > 0.005)
            cap(
              s.day,
              round2(finalCustom - reserveLeft),
              `Reconciliação final — reserve não usada devolvida ($${reserveLeft.toLocaleString("en-US")})${finalCustom !== 0 ? " + fees finais" : ""}`,
              "BANK_RESERVE",
              "RESERVE",
            );
          reserveLeft = 0;
        }
        const capPay =
          !isLast && bank.releaseMode === "SWEEP_PCT_LAST_FULL"
            ? (s.net * bank.sweepPct) / 100
            : s.net;
        let pay = round2(Math.max(0, Math.min(bal, capPay)));
        if (perPayoffPct > 0 && pay > 0) {
          const exit = round2((pay * perPayoffPct) / 100);
          bankOtherFees += exit;
          cap(s.day, exit, `Exit fee ${perPayoffPct}% • ${s.label}`, "BANK_FEE", "PAYOFF_FEES");
          pay = round2(Math.max(0, Math.min(bal, capPay)));
        }
        if (pay > 0) {
          bal = round2(bal - pay);
          flows.push({
            day: s.day,
            amount: -pay,
            bankAmount: -pay,
            label: `Payoff do banco${isLast ? " (quitação)" : ` (sweep ${bank.releaseMode === "SWEEP_PCT_LAST_FULL" ? bank.sweepPct : 100}%)`} • ${s.label}`,
            kind: "BANK_PAYOFF",
          });
        }
      }
      cursor = day;
    }
    if (bal > 0.01) {
      // saldo residual além do que as vendas cobriram — quitado com caixa do pool
      flows.push({ day: cursor, amount: -round2(bal), bankAmount: -round2(bal), label: "Quitação final do loan (residual)", kind: "BANK_PAYOFF" });
    } else if (bal < -0.01) {
      // crédito do banco (ex.: reserve devolvida maior que o saldo restante)
      flows.push({ day: cursor, amount: -round2(bal), bankAmount: -round2(bal), label: "Reconciliação final — devolução do banco", kind: "BANK_PAYOFF" });
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

  const push = (
    day: number,
    amount: number,
    label: string,
    kind: SimEvent["kind"],
    bankAmount?: number,
    bankCat?: SimEvent["bankCat"],
    infoAmount?: number,
  ) => {
    cash = round2(cash + amount);
    if (bankAmount) bankBalance = round2(bankBalance + bankAmount);
    events.push({
      day,
      amount: round2(amount),
      label,
      kind,
      ...(bankAmount ? { bankAmount: round2(bankAmount) } : {}),
      ...(bankCat ? { bankCat } : {}),
      ...(infoAmount ? { infoAmount: round2(infoAmount) } : {}),
      cash,
      invested,
      bankBalance,
    });
  };

  // Aporte único em D+0: injeta o mínimo que garante nunca faltar caixa (pior déficit
  // futuro). O JIT abaixo não dispara; retornos seguem a regra normal — a TIR mostra o
  // custo do capital parado desde o dia zero.
  if (input.upfrontFunding && n > 0) {
    const inj = Math.ceil((futureMinNeed[0] ?? 0) * 100) / 100;
    if (inj > 0) {
      invested = inj;
      totalInjected = inj;
      peak = inj;
      investorFlows.push({ day: 0, amount: -inj });
      push(0, inj, "Aporte único do investidor (100% em D+0)", "INJECTION");
    }
  }

  flows.forEach((f, i) => {
    if (cash + f.amount < -1e-9) {
      const inj = round2(-(cash + f.amount)); // JIT exato, como no mock
      invested = round2(invested + inj);
      totalInjected += inj;
      peak = Math.max(peak, invested);
      investorFlows.push({ day: f.day, amount: -inj });
      push(f.day, inj, "Aporte do investidor (JIT)", "INJECTION");
    }
    push(f.day, f.amount, f.label, f.kind, f.bankAmount, f.bankCat, f.infoAmount);
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
  // PROMOTE sempre; OPEN_BOOK só se os tiers foram preenchidos (promote opcional por cima)
  // Waterfall (promote) = remuneração da VIXUS como Development Manager — opt-in em
  // QUALQUER modalidade da 4U (performance/contractor/open book). Regra do Stefan, 14/07.
  // (compMode PROMOTE legado continua funcionando: obra a custo performance + só promote.)
  if (input.promoteTiers?.length) {
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
      // Deduz dos ÚLTIMOS retornos, de trás p/ frente — em qualquer dia. (Antes só olhava
      // o finalDay exato; com performance-na-conclusão o último flow é o fee da 4U e os
      // retornos terminam dias antes — o promote calculava e nunca era cobrado.)
      let remainingFee = fee;
      for (let i = events.length - 1; i >= 0 && remainingFee > 0.005; i--) {
        const ev = events[i];
        if (ev.kind !== "RETURN") continue;
        const take = round2(Math.min(remainingFee, -ev.amount));
        if (take <= 0) continue;
        ev.amount = round2(ev.amount + take);
        // espelha nos investorFlows do MESMO dia (retornos positivos), de trás p/ frente
        let mirror = take;
        for (let j = investorFlows.length - 1; j >= 0 && mirror > 0.005; j--) {
          const f = investorFlows[j];
          if (f.day !== ev.day || f.amount <= 0) continue;
          const t2 = round2(Math.min(mirror, f.amount));
          f.amount = round2(f.amount - t2);
          mirror = round2(mirror - t2);
        }
        remainingFee = round2(remainingFee - take);
      }
      const feeApplied = round2(fee - remainingFee);
      if (feeApplied > 0) {
        promoteTotal = feeApplied;
        totalReturned = round2(totalReturned - feeApplied);
        events.push({
          day: finalDay,
          amount: -feeApplied,
          label: "Promote Vixus (developer)",
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
      promoteTotal: round2(promoteTotal),
      contractorFeeTotal: round2(contractorFeeTotal),
      bankCommitted: round2(committed),
      bankUpfrontFees: upfrontFees,
      bankInterestTotal: round2(bankInterestTotal),
      bankOtherFees: round2(bankOtherFees),
      bankReserveFunded: round2(reserveFunded),
      bankReserveUnused: round2(reserveUnused),
      bankExtensionFee: round2(extensionFee),
      cashToClosing: round2(cashToClosing),
      equityGateAmount: round2((input.equityGatePct ?? 0) * totalCost),
      loanClosingDay: bank ? loanClosingDay : null,
    },
    events,
    monthly,
    units,
  };
}
