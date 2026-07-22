/**
 * Marcação & retorno (Fase 1 investor-grade, mock aprovado 18/07):
 * - NAV conservador: caixa livre + custo incorrido nas casas NÃO vendidas (equity + obra
 *   do banco) + valorização pela obra (lucro esperado × % concluído) − dívida dos loans.
 *   Casas vendidas ficam de fora (o resultado delas já virou caixa).
 * - TIR viva: XIRR dos fluxos REAIS (aportes/distribuições nas datas do ledger) + o plano
 *   restante (casas não vendidas devolvendo equity + lucro ajustado pelo custo de
 *   financiamento, nas datas de venda do baseline congelado).
 * Módulo puro — Overview, report mensal e portal usam a mesma conta.
 */

const round2 = (v: number) => Math.round(v * 100) / 100;
const DAY_MS = 86_400_000;

export type NavHouse = {
  ownCapital: number; // equity investido na casa (inclui lote)
  bankDrawn: number; // obra financiada creditada pelo banco
  expectedProfit: number | null; // pro forma: venda − (lote+obra+closing)
  buildPct: number; // 0–100 (CO = 100)
  sold: boolean;
  baselineSale: Date | null; // data de venda do baseline congelado
};

export type NavResult = {
  cash: number;
  incurred: number;
  uplift: number;
  debt: number;
  nav: number;
  navPerUnit: number | null;
  endPerUnit: number | null; // projeção de fim (curva J)
};

export function computeNav(opts: {
  freeCash: number;
  houses: NavHouse[];
  debt: number;
  unitsTotal: number;
  raised: number;
  distributed: number;
  projectedProfitNet: number; // lucro total ajustado pelo financiamento (projeção)
}): NavResult {
  const unsold = opts.houses.filter((h) => !h.sold);
  const incurred = round2(unsold.reduce((s, h) => s + h.ownCapital + h.bankDrawn, 0));
  const uplift = round2(
    unsold.reduce((s, h) => s + (h.expectedProfit ?? 0) * Math.min(1, Math.max(0, h.buildPct / 100)), 0),
  );
  const nav = round2(opts.freeCash + incurred + uplift - opts.debt);
  const navPerUnit = opts.unitsTotal > 0 ? round2(nav / opts.unitsTotal) : null;
  const endPerUnit =
    opts.unitsTotal > 0
      ? round2((opts.raised + opts.projectedProfitNet - opts.distributed) / opts.unitsTotal)
      : null;
  return { cash: round2(opts.freeCash), incurred, uplift, debt: round2(opts.debt), nav, navPerUnit, endPerUnit };
}

// ── XIRR (taxa anual) por bissecção — robusto p/ fluxos irregulares ──
export function xirr(flows: Array<{ date: Date; amount: number }>): number | null {
  const fs = flows.filter((f) => Math.abs(f.amount) > 0.01).sort((a, b) => a.date.getTime() - b.date.getTime());
  if (fs.length < 2) return null;
  const hasNeg = fs.some((f) => f.amount < 0);
  const hasPos = fs.some((f) => f.amount > 0);
  if (!hasNeg || !hasPos) return null;
  const t0 = fs[0].date.getTime();
  const npv = (r: number) =>
    fs.reduce((s, f) => s + f.amount / Math.pow(1 + r, (f.date.getTime() - t0) / DAY_MS / 365.25), 0);
  let lo = -0.95;
  let hi = 15;
  let fLo = npv(lo);
  const fHi = npv(hi);
  if (fLo * fHi > 0) return null; // sem raiz no intervalo
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid);
    if (Math.abs(fMid) < 1e-7) return mid;
    if (fLo * fMid < 0) hi = mid;
    else {
      lo = mid;
      fLo = fMid;
    }
  }
  return (lo + hi) / 2;
}

// ── TIR viva: fluxos reais + plano restante ──
export function liveIrr(opts: {
  contributions: Array<{ date: Date; amount: number }>; // positivos (o sinal é aplicado aqui)
  distributions: Array<{ date: Date; amount: number }>;
  houses: NavHouse[];
  financingDrag: number; // custos de financiamento (incorridos + projetados) a abater do lucro
  today: Date;
  // Caixa JÁ recebido e ainda no pool (vendas fechadas, não distribuído). Sem isto a TIR de um
  // pool que vendeu mas ainda não distribuiu fica absurdamente negativa: o modelo via o dinheiro
  // saindo e nada voltando. Entra como retorno na data de encerramento prevista.
  freeCash?: number;
  endDate?: Date | null;
}): { irr: number | null; projectedInflow: number; profitNet: number } {
  const unsold = opts.houses.filter((h) => !h.sold);
  const grossProfit = unsold.reduce((s, h) => s + (h.expectedProfit ?? 0), 0);
  const profitNet = Math.max(0, grossProfit - Math.max(0, opts.financingDrag));
  const scale = grossProfit > 0 ? profitNet / grossProfit : 0;

  const floor = new Date(opts.today.getTime() + 30 * DAY_MS); // venda no passado do plano → +30d
  const flows: Array<{ date: Date; amount: number }> = [
    ...opts.contributions.map((c) => ({ date: c.date, amount: -Math.abs(c.amount) })),
    ...opts.distributions.map((d) => ({ date: d.date, amount: Math.abs(d.amount) })),
    ...unsold.map((h) => ({
      date: h.baselineSale && h.baselineSale.getTime() > floor.getTime() ? h.baselineSale : floor,
      amount: h.ownCapital + (h.expectedProfit ?? 0) * scale,
    })),
  ];
  // o caixa em conta volta ao investidor no encerramento (ou na última venda projetada)
  const cash = Math.max(0, opts.freeCash ?? 0);
  if (cash > 0.01) {
    const lastProjected = flows.reduce<Date | null>(
      (acc, f) => (f.amount > 0 && (!acc || f.date > acc) ? f.date : acc),
      null,
    );
    const cashDate =
      opts.endDate && opts.endDate.getTime() > floor.getTime() ? opts.endDate : (lastProjected ?? floor);
    flows.push({ date: cashDate, amount: cash });
  }
  const projectedInflow = round2(unsold.reduce((s, h) => s + h.ownCapital + (h.expectedProfit ?? 0) * scale, 0));
  return { irr: xirr(flows), projectedInflow, profitNet: round2(profitNet) };
}
