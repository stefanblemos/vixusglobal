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

// Fees PREVISTOS do contrato do banco para um draw creditado (processing + inspection por
// draw; ACH uma vez por data de lote; customs PER_DRAW) — não-conciliados até o extrato.
async function predictedDrawFees(
  loanId: string,
  bank: {
    drawProcessingFee: unknown;
    inspectionFeePerDraw: unknown;
    achFeePerBatch: unknown;
    customFees: Array<{ timing: string; kind: string; amount: unknown; name: string }>;
  } | null,
  creditDate: Date,
  excludeEntryId?: string,
): Promise<Array<{ amount: number; memo: string }>> {
  if (!bank) return [];
  const fees: Array<{ amount: number; memo: string }> = [];
  if (Number(bank.drawProcessingFee) > 0)
    fees.push({ amount: Number(bank.drawProcessingFee), memo: "Draw processing fee (previsto — contrato)" });
  if (Number(bank.inspectionFeePerDraw) > 0)
    fees.push({ amount: Number(bank.inspectionFeePerDraw), memo: "Inspection fee (previsto — contrato)" });
  const drawsSameDay = await prisma.poolLoanEntry.count({
    where: {
      loanId,
      type: "DRAW",
      date: creditDate,
      pending: false,
      ...(excludeEntryId ? { id: { not: excludeEntryId } } : {}),
    },
  });
  if (drawsSameDay === 0 && Number(bank.achFeePerBatch) > 0)
    fees.push({ amount: Number(bank.achFeePerBatch), memo: "ACH fee (previsto — contrato, por lote)" });
  for (const f of bank.customFees.filter((cf) => cf.timing === "PER_DRAW" && cf.kind === "FLAT"))
    fees.push({ amount: Number(f.amount), memo: `${f.name} (previsto — contrato)` });
  return fees;
}

// Lança um DRAW (tela global de Draws). Fluxo real: a SOLICITAÇÃO é salva primeiro
// (pendente — não entra no saldo); a resposta do banco vem depois e é registrada pela
// edição (aí entra no saldo com os fees previstos). Se liberação já é conhecida, entra
// direto creditado.
export async function addDraw(_prev: FormState, formData: FormData): Promise<FormState> {
  const poolId = String(formData.get("poolId") ?? "");
  const houseId = String(formData.get("houseId") ?? "").trim() || null;
  const creditDateRaw = String(formData.get("creditDate") ?? "").trim();
  const requestDateRaw = String(formData.get("requestDate") ?? "").trim();
  const released = optNum(formData.get("releasedAmount"));
  const requested = optNum(formData.get("requestedAmount"));
  if (!poolId) return { error: "Pick the pool." };
  if (released == null && requested == null)
    return { error: "Informe o valor solicitado (pedido pendente) ou o liberado (creditado)." };
  if (requested != null && !requestDateRaw && released == null)
    return { error: "Informe a data da solicitação." };
  if (released != null && !creditDateRaw)
    return { error: "Informe a data do crédito para o valor liberado." };

  const loan = await prisma.poolLoan.findUnique({
    where: { poolId },
    include: { bankProfile: { include: { customFees: true } } },
  });
  if (!loan) return { error: "This pool has no loan yet — set it up in the Loan statement tab." };
  const memo = String(formData.get("memo") ?? "").trim() || null;

  if (released == null) {
    // SOLICITAÇÃO pendente: não afeta o saldo; sem fees até a liberação
    await prisma.poolLoanEntry.create({
      data: {
        loanId: loan.id,
        houseId,
        type: "DRAW",
        pending: true,
        date: new Date(requestDateRaw),
        amount: 0,
        requestedAmount: Math.abs(requested!),
        requestDate: new Date(requestDateRaw),
        memo,
      },
    });
  } else {
    const creditDate = new Date(creditDateRaw);
    const fees = await predictedDrawFees(loan.id, loan.bankProfile, creditDate);
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
          memo,
        },
      }),
      ...fees.map((f) =>
        prisma.poolLoanEntry.create({
          data: { loanId: loan.id, houseId, type: "DRAW_FEE", date: creditDate, amount: f.amount, memo: f.memo },
        }),
      ),
    ]);
  }
  revalidatePath(`/pools/${poolId}/loan`);
  revalidatePath("/pools/draws");
  return undefined;
}

// Edita um draw. Pendente + valor liberado informado = REGISTRA A LIBERAÇÃO: entra no
// saldo na data do crédito e gera os fees previstos do contrato.
export async function editDraw(_prev: FormState, formData: FormData): Promise<FormState> {
  const entryId = String(formData.get("entryId") ?? "");
  if (!entryId) return { error: "Draw not found." };
  const entry = await prisma.poolLoanEntry.findUnique({
    where: { id: entryId },
    include: { loan: { include: { bankProfile: { include: { customFees: true } } } } },
  });
  if (!entry || entry.type !== "DRAW") return { error: "Draw not found." };

  const requested = optNum(formData.get("requestedAmount"));
  const requestDateRaw = String(formData.get("requestDate") ?? "").trim();
  const released = optNum(formData.get("releasedAmount"));
  const creditDateRaw = String(formData.get("creditDate") ?? "").trim();
  const houseId = String(formData.get("houseId") ?? "").trim() || null;
  const memo = String(formData.get("memo") ?? "").trim() || null;

  const releasing = entry.pending && released != null;
  if (releasing && !creditDateRaw) return { error: "Informe a data do crédito." };
  if (!entry.pending && released != null && released <= 0)
    return { error: "Released amount must be greater than 0." };

  const creditDate = creditDateRaw ? new Date(creditDateRaw) : entry.date;
  const fees = releasing
    ? await predictedDrawFees(entry.loanId, entry.loan.bankProfile, creditDate, entry.id)
    : [];

  await prisma.$transaction([
    prisma.poolLoanEntry.update({
      where: { id: entry.id },
      data: {
        houseId,
        requestedAmount: requested,
        requestDate: requestDateRaw ? new Date(requestDateRaw) : entry.requestDate,
        ...(released != null
          ? { amount: Math.abs(released), date: creditDate, pending: false }
          : {}),
        memo,
      },
    }),
    ...fees.map((f) =>
      prisma.poolLoanEntry.create({
        data: {
          loanId: entry.loanId,
          houseId: houseId ?? entry.houseId,
          type: "DRAW_FEE",
          date: creditDate,
          amount: f.amount,
          memo: f.memo,
        },
      }),
    ),
  ]);
  revalidatePath(`/pools/${entry.loan.poolId}/loan`);
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
