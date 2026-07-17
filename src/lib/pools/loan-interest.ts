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
  status: "pago" | "devido" | "vencido" | "corrente" | "previsto";
};

export type LoanInterestView = {
  periods: InterestPeriod[];
  paidTotal: number; // Σ |INTEREST_PAYMENT|
  chargedTotal: number;
  dueNow: number; // períodos fechados ainda não cobertos pelos pagamentos
  nextDue: { date: string; amount: number } | null;
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
  let cumOwed = 0;
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
    const owed = charged > 0 ? charged : expected;

    // vencimento: dia X do mês SEGUINTE ao período
    const due = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth() + 1, Math.min(dueDay, 28)));
    let status: InterestPeriod["status"];
    if (isFuture) status = "previsto";
    else if (isCurrent) status = "corrente";
    else {
      cumOwed = round2(cumOwed + owed);
      status = "devido"; // resolvido abaixo, após alocar os pagamentos na ordem
    }
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

  // pagamentos ALOCADOS na ordem cronológica: fecham os períodos antigos primeiro; o que
  // sobrar antecipa o período corrente
  let paidRemaining = paidTotal;
  for (const p of periods) {
    if (p.status === "previsto") continue;
    const alloc = Math.min(p.owed, paidRemaining);
    p.paid = round2(alloc);
    paidRemaining = round2(paidRemaining - alloc);
    if (p.status !== "corrente") {
      if (p.paid >= p.owed - 0.01) p.status = "pago";
      else
        p.status =
          today.getTime() > new Date(p.dueDate).getTime() + grace * DAY_MS ? "vencido" : "devido";
    }
  }

  const dueNow = round2(Math.max(0, cumOwed - paidTotal));
  const firstUnpaid = periods.find((p) => p.status === "devido" || p.status === "vencido");
  const current = periods.find((p) => p.status === "corrente");
  const nextDue = firstUnpaid
    ? { date: firstUnpaid.dueDate, amount: dueNow }
    : current && current.owed > 0
      ? { date: current.dueDate, amount: current.owed }
      : null;

  return {
    periods,
    paidTotal,
    chargedTotal,
    dueNow,
    nextDue,
    monthlyEst: aprPct != null && balance > 0 ? round2((balance * (aprPct / 100)) / 12) : null,
    balance,
  };
}
