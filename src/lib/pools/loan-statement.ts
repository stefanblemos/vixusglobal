/**
 * Statement interno do construction loan: saldo devido corrido a partir dos lançamentos
 * manuais, e — para cada linha de JURO real — o valor ESPERADO pelo nosso motor (accrual
 * diário APR/360 sobre o caminho do saldo desde o juro anterior), validado contra o loan
 * 77959 da Builders Capital com desvio de ±0,7%. O delta real − esperado é o check de
 * confiabilidade linha a linha.
 */

// Labels dos tipos — aqui (módulo neutro) para servir server E client components.
export const ENTRY_TYPE_LABEL: Record<string, string> = {
  CLOSING_FEE: "Fee de closing",
  RESERVE: "Interest reserve (financiada)",
  DRAW: "Draw (obra)",
  DRAW_FEE: "Fee de draw (inspection/ACH)",
  INTEREST: "Juro mensal (real)",
  INTEREST_PAYMENT: "Pagamento de juro (− reserve)",
  PAYOFF: "Payoff (venda)",
  RECONVEYANCE: "Reconveyance (release)",
  CREDIT: "Crédito / devolução",
  OTHER: "Outro",
};

export type LoanEntryInput = {
  id: string;
  type: string;
  date: Date;
  amount: number; // sinal do extrato: charge +, pagamento −
  houseLabel: string | null;
  memo: string | null;
  reconciled: boolean;
  createdAt: Date;
};

export type StatementRow = LoanEntryInput & {
  balance: number;
  expectedInterest: number | null; // só em linhas INTEREST, quando há APR
  interestDelta: number | null; // real − esperado
};

export type Statement = {
  rows: StatementRow[];
  balance: number; // saldo devido atual
  totalDraws: number;
  totalInterest: number; // juros REAIS lançados
  totalExpectedInterest: number;
  totalFees: number; // closing + draw fees + reconveyance + other
  totalPayoffs: number; // valor absoluto
  totalCredits: number; // valor absoluto
  reconciledCount: number;
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const DAY_MS = 86_400_000;

export function buildStatement(entries: LoanEntryInput[], aprPct: number | null): Statement {
  const rows = [...entries].sort(
    (a, b) => a.date.getTime() - b.date.getTime() || a.createdAt.getTime() - b.createdAt.getTime(),
  );

  let balance = 0;
  let balDays = 0; // Σ (saldo × dias) desde o último lançamento de juro
  let lastDate: Date | null = null;
  let totalDraws = 0;
  let totalInterest = 0;
  let totalExpectedInterest = 0;
  let totalFees = 0;
  let totalPayoffs = 0;
  let totalCredits = 0;
  let reconciledCount = 0;

  const out: StatementRow[] = rows.map((e) => {
    // acumula saldo×dias até a data deste lançamento (antes de aplicá-lo)
    if (lastDate) {
      const days = Math.max(0, Math.round((e.date.getTime() - lastDate.getTime()) / DAY_MS));
      balDays += balance * days;
    }
    lastDate = e.date;

    let expectedInterest: number | null = null;
    let interestDelta: number | null = null;
    if (e.type === "INTEREST") {
      if (aprPct != null) {
        expectedInterest = round2((balDays * aprPct) / 100 / 360);
        interestDelta = round2(e.amount - expectedInterest);
      }
      balDays = 0; // novo período de accrual
      totalInterest += e.amount;
      totalExpectedInterest += expectedInterest ?? 0;
    }

    balance = round2(balance + e.amount);

    if (e.type === "DRAW") totalDraws += e.amount;
    if (["CLOSING_FEE", "DRAW_FEE", "RECONVEYANCE", "OTHER"].includes(e.type) && e.amount > 0)
      totalFees += e.amount;
    if (e.type === "PAYOFF") totalPayoffs += -e.amount;
    if (e.type === "CREDIT") totalCredits += -e.amount;
    if (e.reconciled) reconciledCount += 1;

    return { ...e, balance, expectedInterest, interestDelta };
  });

  return {
    rows: out,
    balance,
    totalDraws: round2(totalDraws),
    totalInterest: round2(totalInterest),
    totalExpectedInterest: round2(totalExpectedInterest),
    totalFees: round2(totalFees),
    totalPayoffs: round2(totalPayoffs),
    totalCredits: round2(totalCredits),
    reconciledCount,
  };
}
