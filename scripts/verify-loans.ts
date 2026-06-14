import {
  simpleInterest,
  originationFee,
  computeLoanBalance,
  type LoanTxnLike,
} from "../src/lib/loans/interest";
import { round } from "../src/lib/money";

let failures = 0;
function check(label: string, got: string, expected: string) {
  const ok = got === expected;
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "FAIL"} | ${label}: ${got} (esperado ${expected})`);
}

const d = (s: string) => new Date(s + "T00:00:00Z");

// 1) Exatamente 365 dias (ano não bissexto): 100.000 × 8% × 365/365 = 8.000
check(
  "Juros 365 dias exatos (ACT_365)",
  round(simpleInterest(100000, 0.08, d("2023-01-01"), d("2024-01-01"), "ACT_365"), 2).toFixed(2),
  "8000.00",
);

// 2) 30/360 ano cheio = 8.000
check(
  "Juros 30/360 ano cheio",
  round(simpleInterest(100000, 0.08, d("2024-01-01"), d("2025-01-01"), "D30_360"), 2).toFixed(2),
  "8000.00",
);

// 3) Juros SIMPLES não capitalizam: 2 anos (30/360) = 16.000, NÃO 16.640
check(
  "Juros simples 2 anos = 16.000 (sem capitalizar)",
  round(simpleInterest(100000, 0.08, d("2024-01-01"), d("2026-01-01"), "D30_360"), 2).toFixed(2),
  "16000.00",
);

// 4) Origination fee 1% de 250.000 = 2.500
check("Origination fee 1%", round(originationFee(250000, 0.01), 2).toFixed(2), "2500.00");

// 4b) Origination fee configurável (2,5%)
check("Origination fee 2,5%", round(originationFee(250000, 0.025), 2).toFixed(2), "6250.00");

// 5) Saldo com desembolso + amortização parcial (30/360 para números exatos):
//    1º semestre: 100k × 8% × 180/360 = 4.000 ; 2º: 60k × 8% × 180/360 = 2.400 ; total 6.400
const loan = {
  annualInterestRate: 0.08,
  dayCountBasis: "D30_360" as const,
  startDate: d("2024-01-01"),
};
const txns: LoanTxnLike[] = [
  { type: "DISBURSEMENT", amount: 100000, date: d("2024-01-01") },
  { type: "ORIGINATION_FEE", amount: 1000, date: d("2024-01-01") },
  { type: "REPAYMENT_PRINCIPAL", amount: 40000, date: d("2024-07-01") },
  { type: "REPAYMENT_INTEREST", amount: 1500, date: d("2024-07-01") },
];
const bal = computeLoanBalance(loan, txns, d("2025-01-01"));
check("Principal em aberto", round(bal.principalOutstanding, 2).toFixed(2), "60000.00");
check("Origination fee cobrada", round(bal.originationFeeCharged, 2).toFixed(2), "1000.00");
check("Juros acumulados (saldo variável)", round(bal.interestAccrued, 2).toFixed(2), "6400.00");
check("Juros pagos", round(bal.interestPaid, 2).toFixed(2), "1500.00");
check("Juros em aberto", round(bal.interestOutstanding, 2).toFixed(2), "4900.00");
check("Total em aberto (principal + juros)", round(bal.totalOutstanding, 2).toFixed(2), "64900.00");

console.log(failures === 0 ? "\nTODOS OS TESTES PASSARAM" : `\n${failures} TESTE(S) FALHARAM`);
process.exit(failures === 0 ? 0 : 1);
