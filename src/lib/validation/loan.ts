import { z } from "zod";

const emptyToNull = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") ? null : v;

// Taxas entram como PERCENTUAL na UI (ex.: 8.5) e são convertidas para fração no action.
export const loanTermsSchema = z.object({
  annualInterestRatePct: z.coerce.number().min(0).max(100),
  originationFeeRatePct: z.coerce.number().min(0).max(100),
  dayCountBasis: z.enum(["ACT_365", "ACT_360", "D30_360"]),
  interestMethod: z.enum(["SIMPLE", "COMPOUND"]),
  startDate: z.coerce.date(),
  maturityDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  status: z.enum(["ACTIVE", "PAID", "DEFAULTED", "CANCELLED"]),
});

export const loanTxnSchema = z.object({
  type: z.enum([
    "DISBURSEMENT",
    "ORIGINATION_FEE",
    "INTEREST_ACCRUAL",
    "REPAYMENT_PRINCIPAL",
    "REPAYMENT_INTEREST",
    "ADJUSTMENT",
  ]),
  amount: z.coerce.number().gt(0, "Amount must be greater than 0"),
  date: z.coerce.date(),
  memo: z.preprocess(emptyToNull, z.string().trim().nullable()),
});
