/**
 * Juros do construction loan por PERÍODO (mock aprovado 17/07): mês a mês desde o closing,
 * com valor esperado (accrual diário APR/360 sobre o caminho do saldo — mesma regra do
 * statement), valor cobrado (linhas INTEREST do extrato), vencimento (dia do mês lido do
 * contrato, default dia 1º do mês seguinte) e status pago/devido/vencido/corrente/previsto.
 * Módulo puro — serve a tela do loan e o menu Juros.
 */

export type InterestEntry = { type: string; date: Date; amount: number };

export type InterestPeriod = {
  start: string; // yyyy-mm-dd
  end: string;
  label: string; // "jun/26" ou "08/05 – 31/05/26"
  baseEnd: number; // saldo ao fim do período (base do juro)
  expected: number;
  charged: number; // Σ INTEREST no período
  owed: number; // cobrado quando existe, senão esperado
  paid: number; // pagamentos ALOCADOS a este período (na ordem cronológica)
  dueDate: string; // vencimento do pagamento
  // aguardando = período fechado que o banco AINDA NÃO cobrou (não é dívida, só previsão)
  status: "pago" | "devido" | "vencido" | "aguardando" | "corrente" | "previsto";
};

export type LoanInterestView = {
  periods: InterestPeriod[];
  paidTotal: number; // Σ |INTEREST_PAYMENT|
  chargedTotal: number;
  dueNow: number; // só o que o banco COBROU e ainda não foi pago (nunca a previsão)
  nextDue: { date: string; amount: number; estimated: boolean } | null;
  currentAccrual: number; // accrual do mês corrente — quanto PROVISIONAR (não é dívida)
  monthlyEst: number | null; // saldo atual × APR/12
  balance: number;
};

const DAY_MS = 86_400_000;
const round2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const MONTH_PT = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

function monthLabel(start: Date, isFirstPartial: boolean, end: Date): string {
  if (isFirstPartial) {
    const dd = (d: Date) => `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    return `${dd(start)} – ${dd(end)}/${String(end.getUTCFullYear()).slice(2)}`;
  }
  return `${MONTH_PT[start.getUTCMonth()]}/${String(start.getUTCFullYear()).slice(2)}`;
}

export function computeLoanInterest(opts: {
  entries: InterestEntry[]; // NÃO-pendentes, valores com sinal do extrato
  aprPct: number | null;
  closingDate: Date | null;
  dueDay: number | null; // dia do vencimento (default 1 = dia 1º do mês seguinte)
  graceDays: number | null;
  today: Date;
}): LoanInterestView | null {
  const { entries, aprPct, closingDate, today } = opts;
  if (!closingDate) return null;
  const dueDay = opts.dueDay ?? 1;
  const grace = opts.graceDays ?? 0;

  const sorted = [...entries].sort((a, b) => a.date.getTime() - b.date.getTime());
  const balance = round2(sorted.reduce((s, e) => s + e.amount, 0));
  const paidTotal = round2(
    sorted.filter((e) => e.type === "INTEREST_PAYMENT").reduce((s, e) => s + Math.abs(e.amount), 0),
  );
  const chargedTotal = round2(
    sorted.filter((e) => e.type === "INTEREST").reduce((s, e) => s + e.amount, 0),
  );

  // caminho do saldo p/ o accrual: tudo entra no saldo (como no statement)
  const steps: Array<{ t: number; bal: number }> = [];
  {
    let bal = 0;
    for (const e of sorted) {
      bal += e.amount;
      steps.push({ t: e.date.getTime(), bal });
    }
  }
  const balanceAt = (d: Date) => {
    let bal = 0;
    for (const s of steps) {
      if (s.t > d.getTime()) break;
      bal = s.bal;
    }
    return bal;
  };

  // meses do closing até o mês corrente + 1 (previsão)
  const periods: InterestPeriod[] = [];
  const cur = new Date(Date.UTC(closingDate.getUTCFullYear(), closingDate.getUTCMonth(), 1));
  const lastMonth = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 1));
  let first = true;
  while (cur.getTime() <= lastMonth.getTime()) {
    const mStart = first ? closingDate : cur;
    const mEnd = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, 0)); // último dia do mês
    const isFuture = mStart.getTime() > today.getTime();
    const isCurrent = !isFuture && mEnd.getTime() >= today.getTime();

    // accrual diário APR/360 do período
    let expected = 0;
    if (aprPct != null) {
      if (isFuture) {
        expected = (balance * (aprPct / 100)) / 12; // previsão: saldo atual × APR/12
      } else {
        let d = new Date(mStart);
        while (d.getTime() <= mEnd.getTime()) {
          expected += (balanceAt(d) * (aprPct / 100)) / 360;
          d = new Date(d.getTime() + DAY_MS);
        }
      }
    }
    expected = round2(expected);
    const charged = round2(
      sorted
        .filter(
          (e) => e.type === "INTEREST" && e.date.getTime() >= mStart.getTime() && e.date.getTime() <= mEnd.getTime(),
        )
        .reduce((s, e) => s + e.amount, 0),
    );
    // REAL × PREVISÃO: a dívida é SÓ o que o banco cobrou. expected fica como referência de
    // provisão e nunca vira devido/vencido. Período fechado sem cobrança = "aguardando extrato".
    const owed = charged;

    // vencimento: dia X do mês SEGUINTE ao período
    const due = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, Math.min(dueDay, 28)));
    let status: InterestPeriod["status"];
    if (isFuture) status = "previsto";
    else if (charged <= 0) status = isCurrent ? "corrente" : "aguardando";
    else status = "devido"; // com cobrança: refinado após alocar os pagamentos
    periods.push({
      start: iso(mStart),
      end: iso(mEnd),
      label: monthLabel(mStart, first && closingDate.getUTCDate() > 1, mEnd),
      baseEnd: round2(isFuture ? balance : balanceAt(mEnd)),
      expected,
      charged,
      owed: round2(owed),
      paid: 0,
      dueDate: iso(due),
      status,
    });
    first = false;
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }

  // pagamentos ALOCADOS só contra períodos COBRADOS (real), na ordem cronológica — fecham os
  // antigos primeiro. Períodos "aguardando"/"corrente" sem cobrança não recebem baixa.
  let paidRemaining = paidTotal;
  for (const p of periods) {
    if (p.charged <= 0) continue;
    const alloc = Math.min(p.charged, paidRemaining);
    p.paid = round2(alloc);
    paidRemaining = round2(paidRemaining - alloc);
    if (p.paid >= p.charged - 0.01) p.status = "pago";
    else
      p.status =
        today.getTime() > new Date(p.dueDate).getTime() + grace * DAY_MS ? "vencido" : "devido";
  }

  // devido agora = só cobrado − pago dos períodos com cobrança real (nunca a previsão)
  const dueNow = round2(
    periods.reduce((s, p) => (p.charged > 0 ? s + Math.max(0, round2(p.charged - p.paid)) : s), 0),
  );
  const firstUnpaid = periods.find((p) => p.status === "devido" || p.status === "vencido");
  const current = periods.find((p) => p.status === "corrente");
  const currentAccrual = round2(
    current?.expected ?? (aprPct != null && balance > 0 ? (balance * (aprPct / 100)) / 12 : 0),
  );
  // próximo vencimento: 1º período cobrado em aberto (real); senão o corrente (previsão, estimated)
  const nextDue = firstUnpaid
    ? { date: firstUnpaid.dueDate, amount: round2(firstUnpaid.charged - firstUnpaid.paid), estimated: false }
    : current
      ? { date: current.dueDate, amount: currentAccrual, estimated: true }
      : null;

  return {
    periods,
    paidTotal,
    chargedTotal,
    dueNow,
    nextDue,
    currentAccrual,
    monthlyEst: aprPct != null && balance > 0 ? round2((balance * (aprPct / 100)) / 12) : null,
    balance,
  };
}
