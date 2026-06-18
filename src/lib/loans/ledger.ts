import { D, ZERO, type Decimal, type DecimalInput } from "../money";

// Razão ano a ano de um empréstimo intercompany, a partir dos valores FORNECIDOS por ano.
// Regra Vixus: o juro não pago até 31/12 integraliza capital NO ANO SEGUINTE, mas fica numa
// conta SEPARADA do principal (juro capitalizado) — para o principal continuar batendo com o
// QBO mesmo quando o juro acumula. O app não recalcula o juro; só faz o roll-forward.

export type LoanYearInput = {
  year: number;
  annualRatePct: DecimalInput | null;
  principalAdded: DecimalInput;
  principalRepaid: DecimalInput;
  interestAccrued: DecimalInput;
  interestPaid: DecimalInput;
  note?: string | null;
};

export type LoanYearRow = {
  year: number;
  annualRatePct: Decimal | null;
  openingPrincipal: Decimal;
  principalAdded: Decimal;
  principalRepaid: Decimal;
  closingPrincipal: Decimal;
  openingCapitalized: Decimal; // juro de anos anteriores que virou capital (separado do principal)
  interestAccrued: Decimal; // juro do ano (fornecido)
  interestPaid: Decimal; // juro pago no ano (fornecido)
  interestUnpaid: Decimal; // accrued − paid (vira capitalizado no próximo ano)
  closingCapitalized: Decimal; // openingCapitalized + interestUnpaid (≥ 0)
  totalOutstanding: Decimal; // closingPrincipal + closingCapitalized
};

export function buildLoanLedger(
  openingPrincipal: DecimalInput,
  years: LoanYearInput[],
): LoanYearRow[] {
  const sorted = [...years].sort((a, b) => a.year - b.year);
  const rows: LoanYearRow[] = [];
  let principal = D(openingPrincipal);
  let capitalized = ZERO;

  for (const y of sorted) {
    const openingPrincipal = principal;
    const openingCapitalized = capitalized;
    const added = D(y.principalAdded);
    const repaid = D(y.principalRepaid);
    const accrued = D(y.interestAccrued);
    const paid = D(y.interestPaid);

    const closingPrincipal = openingPrincipal.add(added).sub(repaid);
    const unpaid = accrued.sub(paid);
    // O capitalizado não fica negativo: se pagaram mais juro do que acumulou, zera o bucket.
    let closingCapitalized = openingCapitalized.add(unpaid);
    if (closingCapitalized.lt(ZERO)) closingCapitalized = ZERO;

    rows.push({
      year: y.year,
      annualRatePct: y.annualRatePct == null ? null : D(y.annualRatePct),
      openingPrincipal,
      principalAdded: added,
      principalRepaid: repaid,
      closingPrincipal,
      openingCapitalized,
      interestAccrued: accrued,
      interestPaid: paid,
      interestUnpaid: unpaid,
      closingCapitalized,
      totalOutstanding: closingPrincipal.add(closingCapitalized),
    });

    principal = closingPrincipal;
    capitalized = closingCapitalized;
  }

  return rows;
}
