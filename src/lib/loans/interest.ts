import { DayCountBasis, LoanTxnType } from "@prisma/client";
import { D, ZERO, sum, type Decimal, type DecimalInput } from "../money";

/**
 * Motor de cálculo de empréstimos intercompany.
 *
 * Regras (Vixus):
 *  - Juros SIMPLES (não compostos): juros incidem só sobre o principal em aberto,
 *    nunca sobre juros acumulados.
 *  - Taxa ANUAL fixa.
 *  - Origination fee (padrão 1%, configurável por empréstimo) sobre o principal.
 *
 * Juros = principal_em_aberto × taxa_anual × (dias / base_do_ano)
 */

const MS_PER_DAY = 86_400_000;

function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Dias corridos (actual) entre duas datas. */
export function actualDays(start: Date, end: Date): number {
  return Math.round((utcMidnight(end) - utcMidnight(start)) / MS_PER_DAY);
}

/** Dias pela convenção 30/360. */
export function days30_360(start: Date, end: Date): number {
  let d1 = start.getUTCDate();
  let d2 = end.getUTCDate();
  const m1 = start.getUTCMonth() + 1;
  const m2 = end.getUTCMonth() + 1;
  const y1 = start.getUTCFullYear();
  const y2 = end.getUTCFullYear();
  if (d1 === 31) d1 = 30;
  if (d2 === 31 && d1 === 30) d2 = 30;
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
}

/** Fração do ano entre duas datas conforme a base (day count). */
export function dayCountFraction(start: Date, end: Date, basis: DayCountBasis): Decimal {
  switch (basis) {
    case "ACT_365":
      return D(actualDays(start, end)).div(365);
    case "ACT_360":
      return D(actualDays(start, end)).div(360);
    case "D30_360":
      return D(days30_360(start, end)).div(360);
    default:
      return D(actualDays(start, end)).div(365);
  }
}

/** Juros simples sobre um principal entre start e end. */
export function simpleInterest(
  principal: DecimalInput,
  annualRate: DecimalInput,
  start: Date,
  end: Date,
  basis: DayCountBasis,
): Decimal {
  if (end <= start) return ZERO;
  return D(principal)
    .mul(D(annualRate))
    .mul(dayCountFraction(start, end, basis));
}

/** Origination fee = principal × taxa (padrão 1%). */
export function originationFee(principal: DecimalInput, feeRate: DecimalInput): Decimal {
  return D(principal).mul(D(feeRate));
}

// ─── Saldo do empréstimo a partir das transações ───

export interface LoanLike {
  annualInterestRate: DecimalInput;
  dayCountBasis: DayCountBasis;
  startDate: Date;
}

export interface LoanTxnLike {
  type: LoanTxnType;
  amount: DecimalInput;
  date: Date;
}

export interface LoanBalance {
  asOf: Date;
  principalOutstanding: Decimal;
  interestAccrued: Decimal;
  interestPaid: Decimal;
  interestOutstanding: Decimal;
  originationFeeCharged: Decimal;
  totalOutstanding: Decimal;
}

/**
 * Calcula o saldo do empréstimo numa data, acumulando juros simples por segmentos
 * de principal em aberto (cada desembolso/amortização inicia um novo segmento).
 */
export function computeLoanBalance(loan: LoanLike, txns: LoanTxnLike[], asOf: Date): LoanBalance {
  const principalEvents = txns
    .filter((t) => t.type === "DISBURSEMENT" || t.type === "REPAYMENT_PRINCIPAL")
    .filter((t) => t.date <= asOf)
    .map((t) => ({
      date: t.date,
      delta: t.type === "DISBURSEMENT" ? D(t.amount) : D(t.amount).neg(),
    }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  let outstanding = ZERO;
  let interestAccrued = ZERO;
  let cursor = loan.startDate;

  for (const ev of principalEvents) {
    if (ev.date > cursor) {
      interestAccrued = interestAccrued.add(
        simpleInterest(outstanding, loan.annualInterestRate, cursor, ev.date, loan.dayCountBasis),
      );
      cursor = ev.date;
    }
    outstanding = outstanding.add(ev.delta);
  }
  if (asOf > cursor) {
    interestAccrued = interestAccrued.add(
      simpleInterest(outstanding, loan.annualInterestRate, cursor, asOf, loan.dayCountBasis),
    );
  }

  const interestPaid = sum(
    txns.filter((t) => t.type === "REPAYMENT_INTEREST" && t.date <= asOf).map((t) => t.amount),
  );
  const originationFeeCharged = sum(
    txns.filter((t) => t.type === "ORIGINATION_FEE" && t.date <= asOf).map((t) => t.amount),
  );

  const interestOutstanding = interestAccrued.sub(interestPaid);

  return {
    asOf,
    principalOutstanding: outstanding,
    interestAccrued,
    interestPaid,
    interestOutstanding,
    originationFeeCharged,
    totalOutstanding: outstanding.add(interestOutstanding),
  };
}
