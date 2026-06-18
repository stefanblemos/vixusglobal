import { DayCountBasis, LoanTxnType } from "@prisma/client";
import { D, ZERO, type Decimal } from "../money";
import { simpleInterest } from "./interest";

// Fechamento ANO A ANO de um empréstimo intercompany. O principal vem do register
// (transações importadas). O app calcula, por ano:
//   - juro do ano = juros SIMPLES diários sobre (principal em aberto + juro já capitalizado),
//     pela taxa do termo VIGENTE naquele ano (reajustável anualmente);
//   - origination fee sobre cada valor aportado (desembolso) no ano;
//   - juro/fee não pagos até 31/12 → capitalizam numa conta SEPARADA no ano seguinte.
// O juro pago por ano é FORNECIDO (o register só traz principal); o resto fica "acrescido".

export type ClosingTxn = { type: LoanTxnType; amount: number; date: Date };

export type AnnualClosing = {
  year: number;
  ratePct: Decimal; // termo vigente no ano (%)
  openingPrincipal: Decimal;
  disbursed: Decimal;
  principalRepaid: Decimal;
  closingPrincipal: Decimal;
  openingCapitalized: Decimal;
  interestAccrued: Decimal; // calculado
  originationFees: Decimal; // calculado (fee × aportes do ano)
  interestPaid: Decimal; // fornecido
  unpaid: Decimal; // accrued + fees − paid (vira capital no próximo ano)
  closingCapitalized: Decimal;
  totalOutstanding: Decimal; // closingPrincipal + closingCapitalized
};

const jan1 = (y: number) => new Date(Date.UTC(y, 0, 1));

export function buildAnnualClosings(input: {
  startDate: Date;
  asOf: Date;
  defaultRatePct: number; // taxa padrão do empréstimo (%)
  rateByYear: Map<number, number>; // override de taxa por ano (%)
  feeRate: number; // origination fee (fração, ex.: 0.01)
  interestPaidByYear: Map<number, number>; // juro pago por ano (fornecido)
  dayCountBasis: DayCountBasis;
  txns: ClosingTxn[];
}): AnnualClosing[] {
  const events = input.txns
    .filter((t) => t.type === "DISBURSEMENT" || t.type === "REPAYMENT_PRINCIPAL")
    .map((t) => ({ date: t.date, delta: t.type === "DISBURSEMENT" ? t.amount : -t.amount }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const startY = input.startDate.getUTCFullYear();
  const endY = input.asOf.getUTCFullYear();
  const rows: AnnualClosing[] = [];
  let principal = ZERO;
  let capitalized = ZERO;

  for (let y = startY; y <= endY; y++) {
    const yStart = y === startY ? input.startDate : jan1(y);
    const yEnd = y === endY ? input.asOf : jan1(y + 1);
    const rate = D((input.rateByYear.get(y) ?? input.defaultRatePct) / 100);

    const openingPrincipal = principal;
    const openingCapitalized = capitalized;

    // Juro sobre o principal, por segmentos (cada desembolso/amortização do ano muda a base).
    let interest = ZERO;
    let outstanding = principal;
    let cursor = yStart;
    for (const e of events.filter((e) => e.date >= yStart && e.date < yEnd)) {
      interest = interest.add(simpleInterest(outstanding, rate, cursor, e.date, input.dayCountBasis));
      outstanding = D(outstanding).add(e.delta);
      cursor = e.date;
    }
    interest = interest.add(simpleInterest(outstanding, rate, cursor, yEnd, input.dayCountBasis));
    // Juro sobre o capitalizado de anos anteriores (constante no ano).
    interest = interest.add(simpleInterest(openingCapitalized, rate, yStart, yEnd, input.dayCountBasis));

    const disbursed = D(
      events.filter((e) => e.delta > 0 && e.date >= yStart && e.date < yEnd).reduce((s, e) => s + e.delta, 0),
    );
    const principalRepaid = D(
      events.filter((e) => e.delta < 0 && e.date >= yStart && e.date < yEnd).reduce((s, e) => s - e.delta, 0),
    );
    const originationFees = disbursed.mul(input.feeRate);
    const interestPaid = D(input.interestPaidByYear.get(y) ?? 0);
    const unpaid = interest.add(originationFees).sub(interestPaid);

    const closingPrincipal = openingPrincipal.add(disbursed).sub(principalRepaid);
    let closingCapitalized = openingCapitalized.add(unpaid);
    if (closingCapitalized.lt(ZERO)) closingCapitalized = ZERO;

    rows.push({
      year: y,
      ratePct: rate.mul(100),
      openingPrincipal,
      disbursed,
      principalRepaid,
      closingPrincipal,
      openingCapitalized,
      interestAccrued: interest,
      originationFees,
      interestPaid,
      unpaid,
      closingCapitalized,
      totalOutstanding: closingPrincipal.add(closingCapitalized),
    });

    principal = closingPrincipal;
    capitalized = closingCapitalized;
  }

  return rows;
}
