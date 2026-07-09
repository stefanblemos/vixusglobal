"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { PoolLoanEntryType } from "@prisma/client";

export type FormState = { error?: string; ok?: boolean } | undefined;

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : NaN;
};
const optNum = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const optDate = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s ? new Date(s) : null;
};

// Tipos cujo valor REDUZ a dívida — o usuário digita positivo, o app aplica o sinal.
const NEGATIVE_TYPES = new Set(["INTEREST_PAYMENT", "PAYOFF", "CREDIT"]);

const ENTRY_TYPES = [
  "CLOSING_FEE",
  "RESERVE",
  "DRAW",
  "DRAW_FEE",
  "INTEREST",
  "INTEREST_PAYMENT",
  "PAYOFF",
  "RECONVEYANCE",
  "CREDIT",
  "OTHER",
] as const;

// Cria/edita o construction loan do pool (termos).
export async function savePoolLoan(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const data = {
    bankProfileId: String(formData.get("bankProfileId") ?? "").trim() || null,
    loanNumber: String(formData.get("loanNumber") ?? "").trim() || null,
    committed: optNum(formData.get("committed")),
    aprPct: optNum(formData.get("aprPct")),
    expectedClosingDate: optDate(formData.get("expectedClosingDate")),
    closingDate: optDate(formData.get("closingDate")),
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
  await prisma.poolLoan.upsert({
    where: { poolId },
    create: { poolId, ...data },
    update: data,
  });
  revalidatePath(`/pools/${poolId}/loan`);
  return { ok: true };
}

export async function addLoanEntry(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const loan = await prisma.poolLoan.findUnique({ where: { poolId } });
  if (!loan) return { error: "Set up the loan terms first." };

  const type = String(formData.get("type") ?? "");
  if (!ENTRY_TYPES.includes(type as (typeof ENTRY_TYPES)[number]))
    return { error: "Pick the entry type." };
  const dateRaw = String(formData.get("date") ?? "").trim();
  if (!dateRaw) return { error: "Date is required." };
  const raw = num(formData.get("amount"));
  if (!Number.isFinite(raw) || raw === 0) return { error: "Amount must be a non-zero number." };

  // sinal automático: usuário digita positivo; payoff/pagamento/crédito reduzem a dívida
  const amount = NEGATIVE_TYPES.has(type) ? -Math.abs(raw) : Math.abs(raw);
  const houseId = String(formData.get("houseId") ?? "").trim() || null;

  await prisma.poolLoanEntry.create({
    data: {
      loanId: loan.id,
      houseId,
      type: type as PoolLoanEntryType,
      date: new Date(dateRaw),
      amount,
      memo: String(formData.get("memo") ?? "").trim() || null,
    },
  });
  revalidatePath(`/pools/${poolId}/loan`);
  return undefined;
}

export async function deleteLoanEntry(formData: FormData): Promise<void> {
  const id = String(formData.get("entryId") ?? "");
  const poolId = String(formData.get("poolId") ?? "");
  if (id) await prisma.poolLoanEntry.delete({ where: { id } });
  if (poolId) revalidatePath(`/pools/${poolId}/loan`);
}

// Concilia/desconcilia uma linha contra o extrato do banco.
export async function toggleLoanEntryReconciled(formData: FormData): Promise<void> {
  const id = String(formData.get("entryId") ?? "");
  const poolId = String(formData.get("poolId") ?? "");
  if (!id) return;
  const entry = await prisma.poolLoanEntry.findUnique({ where: { id } });
  if (!entry) return;
  await prisma.poolLoanEntry.update({ where: { id }, data: { reconciled: !entry.reconciled } });
  if (poolId) revalidatePath(`/pools/${poolId}/loan`);
  revalidatePath("/pools/draws");
}

// Lança um DRAW (tela global de Draws): valor solicitado + data da solicitação, valor
// LIBERADO + data do crédito (o que entra no saldo). Junto, os fees PREVISTOS do contrato
// do banco (processing + inspection por draw; ACH uma vez por data com draws) — entram
// não-conciliados para validação posterior contra o extrato.
export async function addDraw(_prev: FormState, formData: FormData): Promise<FormState> {
  const poolId = String(formData.get("poolId") ?? "");
  const houseId = String(formData.get("houseId") ?? "").trim() || null;
  const creditDateRaw = String(formData.get("creditDate") ?? "").trim();
  const requestDateRaw = String(formData.get("requestDate") ?? "").trim();
  const released = num(formData.get("releasedAmount"));
  const requested = optNum(formData.get("requestedAmount"));
  if (!poolId) return { error: "Pick the pool." };
  if (!creditDateRaw) return { error: "Credit date is required." };
  if (!Number.isFinite(released) || released <= 0)
    return { error: "Released amount must be greater than 0." };

  const loan = await prisma.poolLoan.findUnique({
    where: { poolId },
    include: { bankProfile: { include: { customFees: true } } },
  });
  if (!loan) return { error: "This pool has no loan yet — set it up in the Loan statement tab." };

  const creditDate = new Date(creditDateRaw);
  const bank = loan.bankProfile;

  // ACH (fee por LOTE de draws): só se for o primeiro draw desta data
  const drawsSameDay = await prisma.poolLoanEntry.count({
    where: { loanId: loan.id, type: "DRAW", date: creditDate },
  });

  const fees: Array<{ amount: number; memo: string }> = [];
  if (bank) {
    if (Number(bank.drawProcessingFee) > 0)
      fees.push({ amount: Number(bank.drawProcessingFee), memo: "Draw processing fee (previsto — contrato)" });
    if (Number(bank.inspectionFeePerDraw) > 0)
      fees.push({ amount: Number(bank.inspectionFeePerDraw), memo: "Inspection fee (previsto — contrato)" });
    if (drawsSameDay === 0 && Number(bank.achFeePerBatch) > 0)
      fees.push({ amount: Number(bank.achFeePerBatch), memo: "ACH fee (previsto — contrato, por lote)" });
    for (const f of bank.customFees.filter((cf) => cf.timing === "PER_DRAW" && cf.kind === "FLAT"))
      fees.push({ amount: Number(f.amount), memo: `${f.name} (previsto — contrato)` });
  }

  await prisma.$transaction([
    prisma.poolLoanEntry.create({
      data: {
        loanId: loan.id,
        houseId,
        type: "DRAW",
        date: creditDate,
        amount: Math.abs(released),
        requestedAmount: requested,
        requestDate: requestDateRaw ? new Date(requestDateRaw) : null,
        memo: String(formData.get("memo") ?? "").trim() || null,
      },
    }),
    ...fees.map((f) =>
      prisma.poolLoanEntry.create({
        data: { loanId: loan.id, houseId, type: "DRAW_FEE", date: creditDate, amount: f.amount, memo: f.memo },
      }),
    ),
  ]);
  revalidatePath(`/pools/${poolId}/loan`);
  revalidatePath("/pools/draws");
  return undefined;
}

// Lança o juro REAL do mês (aba Juros & reserve): cria INTEREST e, se "pago da reserve",
// o INTEREST_PAYMENT espelhado na mesma data (padrão Builders Capital — saldo não compõe).
export async function addMonthlyInterest(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const loan = await prisma.poolLoan.findUnique({ where: { poolId } });
  if (!loan) return { error: "Set up the loan terms first." };
  const dateRaw = String(formData.get("date") ?? "").trim();
  if (!dateRaw) return { error: "Date is required." };
  const raw = num(formData.get("amount"));
  if (!Number.isFinite(raw) || raw <= 0) return { error: "Amount must be greater than 0." };
  const fromReserve = formData.get("fromReserve") === "on";
  const memo = String(formData.get("memo") ?? "").trim() || null;

  await prisma.$transaction([
    prisma.poolLoanEntry.create({
      data: { loanId: loan.id, type: "INTEREST", date: new Date(dateRaw), amount: Math.abs(raw), memo },
    }),
    ...(fromReserve
      ? [
          prisma.poolLoanEntry.create({
            data: {
              loanId: loan.id,
              type: "INTEREST_PAYMENT",
              date: new Date(dateRaw),
              amount: -Math.abs(raw),
              memo: "Pago da interest reserve",
            },
          }),
        ]
      : []),
  ]);
  revalidatePath(`/pools/${poolId}`);
  revalidatePath(`/pools/${poolId}/loan`);
  return undefined;
}

// Gera o PAYOFF (e reconveyance, se o banco cobra) a partir dos dados de venda da casa —
// evita digitar duas vezes o que já está na ficha da casa.
export async function generatePayoffFromHouse(formData: FormData): Promise<void> {
  const poolId = String(formData.get("poolId") ?? "");
  const houseId = String(formData.get("houseId") ?? "");
  if (!poolId || !houseId) return;
  const [loan, house] = await Promise.all([
    prisma.poolLoan.findUnique({ where: { poolId }, include: { bankProfile: true } }),
    prisma.poolHouse.findUnique({ where: { id: houseId } }),
  ]);
  if (!loan || !house || house.payoffAmount == null || house.saleDate == null) return;

  const exists = await prisma.poolLoanEntry.findFirst({
    where: { loanId: loan.id, houseId, type: "PAYOFF" },
  });
  if (exists) return; // já lançado

  const reconveyance = Number(loan.bankProfile?.reconveyanceFee ?? 0);
  await prisma.$transaction([
    ...(reconveyance > 0
      ? [
          prisma.poolLoanEntry.create({
            data: {
              loanId: loan.id,
              houseId,
              type: "RECONVEYANCE",
              date: house.saleDate,
              amount: reconveyance,
              memo: "Gerado da venda da casa",
            },
          }),
        ]
      : []),
    prisma.poolLoanEntry.create({
      data: {
        loanId: loan.id,
        houseId,
        type: "PAYOFF",
        date: house.saleDate,
        amount: -Math.abs(Number(house.payoffAmount)),
        memo: "Gerado da venda da casa",
      },
    }),
  ]);
  revalidatePath(`/pools/${poolId}/loan`);
}
