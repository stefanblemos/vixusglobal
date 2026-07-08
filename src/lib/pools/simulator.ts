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

export type SimBank = {
  ltcBuildPct: number;
  ltcLandPct: number;
  financeLand: boolean;
  ltvPct: number;
  haircutPct: number;
  perUnitCap: number | null;
  aprPct: number;
  originationPct: number;
  originationFlat: number;
  closingFeePct: number; // % do comprometido
  appraisalFee: number;
  legalFee: number;
  inspectionFeePerDraw: number;
  servicingMonthly: number;
  hasInterestReserve: boolean;
  feesFinanced: boolean;
};

export type SimUnitInput = {
  label: string; // "Modelo — Local"
  locationName: string;
  modelName: string;
  permitDays: number;
  lotLeadDays: number;
  saleDays: number;
  buildMonths: number;
  directCost: number;
  contractorFee: number; // 0 em modo performance
  lotCost: number;
  salePrice: number;
};

export type SimInput = {
  fundingMode: "EQUITY" | "BANK";
  compMode: "CONTRACTOR_FEE" | "PERFORMANCE";
  perfPct: number; // fração (0.35)
  perfTiming: "PER_SALE" | "PROJECT_COMPLETION";
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

// Fases de desembolso da obra (draw schedule do mock: 10/30/20/20/15/5).
const PHASES: Array<{ pct: number; name: string }> = [
  { pct: 0.1, name: "Permit application" },
  { pct: 0.3, name: "Permit issued" },
  { pct: 0.2, name: "Truss delivery" },
  { pct: 0.2, name: "Drywall installation" },
  { pct: 0.15, name: "Tile installation" },
  { pct: 0.05, name: "CO issued" },
];

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

  // ── 1. Unidades: valores ajustados pelo cenário + cronograma ──
  const units: SimUnitResult[] = input.units.map((u, i) => {
    const s = schedule(u, i, input);
    const adjLot = u.lotCost * (1 + sc.lotCostBufferPct / 100);
    const baseBuild = u.directCost + (perfOn ? 0 : u.contractorFee);
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
  const upfrontFees = bank
    ? round2(
        committed * (bank.closingFeePct / 100) +
          committed * (bank.originationPct / 100) +
          bank.originationFlat +
          bank.appraisalFee +
          bank.legalFee,
      )
    : 0;
  // Closing do loan: no último permit aprovado (padrão do mock).
  const loanClosingDay = bank ? Math.max(...units.map((u) => u.tPermitOk)) : 0;

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
    PHASES.forEach((p, pi) => {
      let amt = u.adjBuild * p.pct;
      const label = `Fase ${pi + 1} • ${p.name} • ${Math.round(p.pct * 100)}% • ${u.label}`;
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

    if (!perfOn) contractorFeeTotal += u.contractorFee;

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

  // ── 4. Banco: juros mensais, fees e payoff transformados em fluxos do owner ──
  let bankInterestTotal = 0;
  if (bank) {
    // fees upfront: financiados capitalizam; senão saem do caixa no closing
    if (!bank.feesFinanced)
      flows.push({ day: loanClosingDay, amount: -upfrontFees, label: "Fees de closing do loan (não financiados)", kind: "BANK_FEE" });

    // Monta a linha do tempo do saldo do banco para calcular juros/servicing por mês e o
    // payoff em cada venda (sweep 100% do líquido até quitar).
    type BankEvt = { day: number; amount: number; label: string; isDraw?: boolean };
    const bevts: BankEvt[] = [
      ...(bank.feesFinanced ? [{ day: loanClosingDay, amount: upfrontFees, label: "Fees de closing (capitalizados)" }] : []),
      ...bankDraws.map((d) => ({ ...d, isDraw: true })),
    ].sort((a, b) => a.day - b.day);
    const sales = units
      .map((u) => ({ day: u.tCashIn, net: u.adjSaleNet, label: u.label }))
      .sort((a, b) => a.day - b.day);

    let bal = 0;
    let cursor = loanClosingDay;
    let bi = 0;
    let si = 0;
    const horizon = lastSaleDay + 30;
    for (let day = loanClosingDay; day <= horizon; day++) {
      while (bi < bevts.length && bevts[bi].day <= day) {
        const e = bevts[bi++];
        bal += e.amount;
        if (e.isDraw && bank.inspectionFeePerDraw > 0) {
          if (bank.hasInterestReserve) bal += bank.inspectionFeePerDraw;
          else flows.push({ day: e.day, amount: -bank.inspectionFeePerDraw, label: `Inspection fee • draw`, kind: "BANK_FEE" });
        }
      }
      // juros + servicing a cada 30 dias desde o closing
      if (day > loanClosingDay && (day - loanClosingDay) % 30 === 0 && bal > 0) {
        const interest = round2((bal * bank.aprPct) / 100 / 12);
        const monthCost = interest + bank.servicingMonthly;
        bankInterestTotal += monthCost;
        if (bank.hasInterestReserve) bal += monthCost; // capitaliza (reserve)
        else flows.push({ day, amount: -monthCost, label: `Juros do loan (mês ${Math.round((day - loanClosingDay) / 30)})`, kind: "BANK_INTEREST" });
      }
      // payoff nas vendas: banco recebe primeiro (sweep 100% do líquido)
      while (si < sales.length && sales[si].day <= day) {
        const s = sales[si++];
        const pay = round2(Math.min(bal, s.net));
        if (pay > 0) {
          bal -= pay;
          flows.push({ day: s.day, amount: -pay, label: `Payoff do banco • ${s.label}`, kind: "BANK_PAYOFF" });
        }
      }
      cursor = day;
    }
    if (bal > 0.01) {
      // saldo residual (juros capitalizados além das vendas) quitado no fim
      flows.push({ day: cursor, amount: -round2(bal), label: "Quitação final do loan (residual)", kind: "BANK_PAYOFF" });
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
  if (cash > 0.01) {
    totalReturned += cash;
    investorFlows.push({ day: flows[n - 1]?.day ?? 0, amount: cash });
    push(flows[n - 1]?.day ?? 0, -cash, "Distribuição final", "RETURN");
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
      equityGateAmount: round2((input.equityGatePct ?? 0) * totalCost),
    },
    events,
    monthly,
    units,
  };
}
