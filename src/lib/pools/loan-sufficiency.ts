/**
 * Suficiência do financiamento — FONTE ÚNICA (17/07): usada pelo Statement/Casas do loan
 * e pelo Overview do pool (aporte estimado líquido dos loans). Módulo puro: recebe os
 * objetos do Prisma "como vêm" (Decimals viram Number aqui).
 *
 * Por casa: necessário do banco = obra estimada − aporte próprio além do lote;
 * disponível = drawable − consumido (modalidade POR DENTRO: fee de draw COM casa desconta
 * da própria casa; closing/reserve/crédito rateiam; POR FORA: nada desconta).
 * Por loan: líquido das casas − custos por vir (juros até o payoff, fees de draw futuros,
 * cobranças de closing pendentes) = resultado. Σ resultados = a conta do pool.
 */

type Dec = unknown;
const num = (v: Dec): number | null => (v == null ? null : Number(v));

export type SuffRow = {
  addr: string;
  obra: number | null;
  equity: number | null;
  necessario: number | null;
  disponivel: number | null;
  delta: number | null;
};

export type SuffAgg = {
  loanId: string;
  label: string;
  quitado: boolean;
  rows: SuffRow[];
  liquido: number;
  jurosEst: number;
  mesesRest: number;
  aprL: number | null;
  drawFeeEst: number;
  closingPend: number;
  custosPorVir: number;
  resultado: number;
};

export type SuffLoanInput = {
  id: string;
  loanNumber: string | null;
  aprPct: Dec;
  committed: Dec;
  closingDate: Date | null;
  feesInEnvelope: boolean | null;
  bankProfile: {
    name: string;
    rateType: string;
    aprPct: Dec;
    indexPct: Dec;
    spreadPct: Dec;
    termMonths: number;
    inspectionFeePerDraw: Dec;
  } | null;
  entries: Array<{ type: string; amount: Dec; pending: boolean; houseId: string | null }>;
  documents?: Array<{ id: string; fileName: string; kind: string; extracted: unknown }>;
};

export type SuffHouseInput = {
  id: string;
  address: string;
  loanId: string | null;
  bankLoanAmount: Dec;
  plannedBuildCost: Dec;
  actualLotCost: Dec;
  plannedLotCost: Dec;
  ownCapital: Dec;
};

export type RawChargeCandidate = {
  docId: string;
  idx: number | "cash";
  name: string;
  fileName: string;
  date: string; // yyyy-mm-dd
  amount: number;
  financed: boolean;
  isCredit: boolean;
};

type ExLite = {
  feesAtClosing?: Array<{ name: string; amount: number; financed: boolean }>;
  cashToBorrower?: number;
  closingDate?: string;
  docDate?: string;
};

// Cobranças achadas na leitura dos documentos e ausentes do statement (dedupe por valor
// contra lançamentos do loan e despesas do pool)
export function rawChargeCandidatesOf(
  loan: SuffLoanInput,
  expenseAmounts: number[],
): RawChargeCandidate[] {
  const out: RawChargeCandidate[] = [];
  const launched = [
    ...loan.entries
      .filter((e) => ["CLOSING_FEE", "DRAW_FEE", "OTHER", "RESERVE", "DRAW"].includes(e.type))
      .map((e) => Number(e.amount)),
    ...expenseAmounts,
  ];
  const near = (a: number) => launched.some((x) => Math.abs(Math.abs(x) - a) < 1);
  const seen = new Set<string>();
  for (const d of (loan.documents ?? []).filter(
    (dd) => ["AGREEMENT", "NOTE", "SETTLEMENT"].includes(dd.kind) && dd.extracted != null,
  )) {
    const ex = d.extracted as ExLite;
    const date = ex.closingDate?.trim() || ex.docDate?.trim() || "";
    (ex.feesAtClosing ?? []).forEach((f, i) => {
      const dupKey = `${f.name.toLowerCase()}|${Math.round(f.amount)}`;
      if (f.amount <= 0 || near(f.amount) || seen.has(dupKey)) return;
      seen.add(dupKey);
      out.push({ docId: d.id, idx: i, name: f.name, fileName: d.fileName, date, amount: f.amount, financed: f.financed, isCredit: false });
    });
    const cash = ex.cashToBorrower ?? 0;
    if (cash > 0 && !near(cash) && !seen.has(`cash|${Math.round(cash)}`)) {
      seen.add(`cash|${Math.round(cash)}`);
      out.push({
        docId: d.id,
        idx: "cash",
        name: "Crédito recebido no closing (cash to borrower)",
        fileName: d.fileName,
        date,
        amount: cash,
        financed: true,
        isCredit: true,
      });
    }
  }
  return out;
}

function monthsUntil(target: Date | null, from: Date): number {
  if (!target || target.getTime() <= from.getTime()) return 0;
  return Math.max(1, Math.round((target.getTime() - from.getTime()) / (30 * 24 * 60 * 60 * 1000)));
}

export function computeSuffAggs(
  pool: {
    loans: SuffLoanInput[];
    houses: SuffHouseInput[];
    expenses: Array<{ amount: Dec }>;
    scheduleBaseline: unknown;
  },
  today: Date,
): SuffAgg[] {
  const expenseAmounts = pool.expenses.map((e) => Number(e.amount));
  const baselinePayoff = (() => {
    const b = pool.scheduleBaseline as { pool?: { loanPayoff?: string | null } } | null;
    return b?.pool?.loanPayoff ? new Date(b.pool.loanPayoff) : null;
  })();

  return pool.loans.map((l) => {
    const lHouses = pool.houses.filter((h) => h.loanId === l.id);
    const solid = l.entries.filter((e) => !e.pending);
    const balanceL = solid.reduce((s, e) => s + Number(e.amount), 0);
    const quitado = solid.some((e) => e.type === "PAYOFF") && balanceL <= 0.01 && solid.length > 0;
    const inEnv = l.feesInEnvelope !== false;
    const feesByH = new Map<string, number>();
    let consumedGen = 0;
    for (const e of solid.filter((x) => ["CLOSING_FEE", "OTHER", "RESERVE", "DRAW_FEE"].includes(x.type))) {
      if (e.type === "DRAW_FEE" && e.houseId)
        feesByH.set(e.houseId, (feesByH.get(e.houseId) ?? 0) + Number(e.amount));
      else consumedGen += Number(e.amount);
    }
    const drawTotal = lHouses.reduce((s, h) => s + (num(h.bankLoanAmount) ?? 0), 0);
    const rows: SuffRow[] = lHouses.map((h) => {
      const drawable = num(h.bankLoanAmount);
      const obra = num(h.plannedBuildCost);
      if (drawable == null || obra == null)
        return { addr: h.address.split(",")[0], obra, equity: null, necessario: null, disponivel: drawable, delta: null };
      const lote = num(h.actualLotCost) ?? num(h.plannedLotCost) ?? 0;
      const equity = Math.max(0, (num(h.ownCapital) ?? 0) - lote);
      const necessario = Math.max(0, obra - equity);
      const consumidoH = inEnv
        ? (drawTotal > 0 ? consumedGen * (drawable / drawTotal) : 0) + (feesByH.get(h.id) ?? 0)
        : 0;
      const disponivel = drawable - consumidoH;
      return { addr: h.address.split(",")[0], obra, equity, necessario, disponivel, delta: disponivel - necessario };
    });
    const liquido = rows.reduce((s, r) => s + (r.delta ?? 0), 0);
    const aprL =
      num(l.aprPct) ??
      (l.bankProfile
        ? l.bankProfile.rateType === "FIXED"
          ? num(l.bankProfile.aprPct)
          : (num(l.bankProfile.indexPct) ?? 0) + (num(l.bankProfile.spreadPct) ?? 0)
        : null);
    const mesesRest = quitado
      ? 0
      : monthsUntil(baselinePayoff, today) || (l.bankProfile ? l.bankProfile.termMonths : 0);
    const jurosEst =
      aprL != null && drawTotal > 0 && !quitado
        ? (aprL / 100 / 12) * ((Math.max(0, balanceL) + drawTotal) / 2) * mesesRest
        : 0;
    const drawsFeitos = solid.filter((e) => e.type === "DRAW").length;
    const drawFeeEst = l.bankProfile
      ? (num(l.bankProfile.inspectionFeePerDraw) ?? 0) * Math.max(0, lHouses.length * 4 - drawsFeitos)
      : 0;
    const closingPend = rawChargeCandidatesOf(l, expenseAmounts).reduce((s, c) => s + c.amount, 0);
    const custosPorVir = jurosEst + drawFeeEst + closingPend;
    return {
      loanId: l.id,
      label: `${l.bankProfile?.name?.split(" ")[0] ?? "Banco"}${l.loanNumber ? ` · ${l.loanNumber}` : ""}`,
      quitado,
      rows,
      liquido,
      jurosEst,
      mesesRest,
      aprL,
      drawFeeEst,
      closingPend,
      custosPorVir,
      resultado: liquido - custosPorVir,
    };
  });
}

// A sobra (ou falta) líquida do CONJUNTO dos loans ativos — o número que abate o aporte
export function poolLoanSurplus(aggs: SuffAgg[]): number {
  return aggs.filter((a) => !a.quitado && a.rows.length > 0).reduce((s, a) => s + a.resultado, 0);
}
