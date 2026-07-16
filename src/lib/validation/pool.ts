import { z } from "zod";

const emptyToNull = (v: unknown) =>
  v == null || (typeof v === "string" && v.trim() === "") ? null : v;

// Números vêm da UI como string com vírgulas ("412,196.40"). `money` = obrigatório > 0;
// `optMoney` = opcional (vazio → null).
const stripCommas = (v: unknown) => String(v ?? "").replace(/,/g, "").trim();

const money = z.preprocess((v) => {
  const s = stripCommas(v);
  const n = Number(s);
  return s === "" || !Number.isFinite(n) ? undefined : n; // undefined → falha de validação
}, z.number().gt(0, "Amount must be greater than 0."));

const optMoney = z.preprocess((v) => {
  if (v == null) return null;
  const s = stripCommas(v);
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}, z.number().nullable());

export const poolSchema = z.object({
  code: z.string().trim().min(1, "Code is required (e.g. VHP-I)."),
  name: z.string().trim().min(1, "Legal name is required."),
  alias: z.preprocess(emptyToNull, z.string().trim().nullable()),
  unitPrice: z.preprocess((v) => {
    const s = stripCommas(v);
    const n = Number(s);
    return s === "" || !Number.isFinite(n) ? undefined : n;
  }, z.number().gt(0).default(1000)),
  targetAmount: optMoney,
  profitSharePct: z.preprocess(
    (v) => (v == null || String(v).trim() === "" ? null : v),
    z.coerce.number().min(0).max(100).nullable(),
  ),
  profitShareTiming: z.enum(["PER_SALE", "PROJECT_COMPLETION"]).nullable().default(null).or(z.literal("").transform(() => null)),
  fundingDeadline: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  startDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  plannedEndDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  effectiveEndDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  notes: z.preprocess(emptyToNull, z.string().trim().nullable()),
});

export const poolStatusSchema = z.enum(["FUNDING", "ACTIVE", "CLOSING", "CLOSED"]);

export const houseSchema = z.object({
  address: z.string().trim().min(1, "Address is required."),
  catalogModelId: z.preprocess(emptyToNull, z.string().nullable()),
  catalogLocationId: z.preprocess(emptyToNull, z.string().nullable()),
  loanId: z.preprocess(emptyToNull, z.string().nullable()), // loan que financia a casa (null = equity)
  status: z.enum([
    "PLANNED",
    "LOT_PURCHASED",
    "UNDER_CONSTRUCTION",
    "FOR_SALE",
    "UNDER_CONTRACT",
    "SOLD",
  ]).default("PLANNED"),
  plannedLotCost: optMoney,
  plannedBuildCost: optMoney,
  plannedSalePrice: optMoney,
  plannedClosingCost: optMoney,
  bankName: z.preprocess(emptyToNull, z.string().trim().nullable()),
  bankLoanAmount: optMoney,
  bankOriginationFee: optMoney,
  bankInterestReserve: optMoney,
  bankCashToClose: optMoney,
  bankBudgetReviewFee: optMoney,
  bankCharges: optMoney,
  actualLotCost: optMoney,
  actualBuildCost: optMoney,
  ownCapital: optMoney,
  soldPrice: optMoney,
  payoffAmount: optMoney,
  netReceived: optMoney,
  closingCost: optMoney,
  contractDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  saleDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  lotContractDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  lotPaidDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  permitAppliedDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  permitIssuedDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  buildStartDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  coDate: z.preprocess(emptyToNull, z.coerce.date().nullable()),
  notes: z.preprocess(emptyToNull, z.string().trim().nullable()),
});

// Aportes e transferências devem ser múltiplos de $1.000 (1 unit = $1.000, sem fração).
const money1000 = money.refine(
  (v) => Math.abs(v % 1000) < 1e-6,
  "Amount must be a multiple of $1,000.",
);

export const contributionSchema = z.object({
  memberId: z.string().min(1, "Pick the investor."),
  date: z.coerce.date(),
  amount: money1000,
  memo: z.preprocess(emptyToNull, z.string().trim().nullable()),
});

export const transferSchema = z.object({
  fromMemberId: z.string().min(1, "Pick who sells the units."),
  toMemberId: z.string().min(1, "Pick who buys the units."),
  date: z.coerce.date(),
  amount: money1000,
  memo: z.preprocess(emptyToNull, z.string().trim().nullable()),
});

export const distributionSchema = z.object({
  kind: z.enum(["RETURN_OF_CAPITAL", "PROFIT"]),
  date: z.coerce.date(),
  totalAmount: money,
  houseId: z.preprocess(emptyToNull, z.string().nullable()),
  memo: z.preprocess(emptyToNull, z.string().trim().nullable()),
});
