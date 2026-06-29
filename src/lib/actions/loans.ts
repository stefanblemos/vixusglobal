"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { loanTermsSchema, loanTxnSchema } from "@/lib/validation/loan";
import { parseLoanRegister } from "@/lib/loans/register";
import { DayCountBasis, LoanInterestMethod, LoanStatus, LoanTxnType } from "@prisma/client";

export type FormState = { error?: string } | undefined;

// Cria um novo empréstimo intercompany (emprestador → tomador). O principal/transações vêm
// depois pelo register; aqui só os termos. Redireciona pro detalhe pra importar o ledger.
export async function createLoan(_prev: FormState, formData: FormData): Promise<FormState> {
  const lenderCompanyId = String(formData.get("lenderCompanyId") ?? "");
  const borrowerCompanyId = String(formData.get("borrowerCompanyId") ?? "");
  if (!lenderCompanyId || !borrowerCompanyId) return { error: "Pick lender and borrower." };
  if (lenderCompanyId === borrowerCompanyId)
    return { error: "Lender and borrower must be different." };
  const startRaw = String(formData.get("startDate") ?? "").trim();
  const rate = Number(formData.get("annualInterestRatePct"));
  const fee = Number(formData.get("originationFeeRatePct"));

  const loan = await prisma.intercompanyLoan.create({
    data: {
      lenderCompanyId,
      borrowerCompanyId,
      principal: 0, // vem do register
      currency: String(formData.get("currency") ?? "USD").trim() || "USD",
      annualInterestRate: (Number.isFinite(rate) ? rate : 0) / 100,
      originationFeeRate: (Number.isFinite(fee) ? fee : 1) / 100,
      dayCountBasis: "ACT_365",
      interestMethod: "SIMPLE",
      startDate: startRaw ? new Date(startRaw) : new Date(),
    },
  });
  revalidatePath("/loans");
  redirect(`/loans/${loan.id}`);
}

export async function updateLoanTerms(
  loanId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loanTermsSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };
  const d = parsed.data;

  await prisma.intercompanyLoan.update({
    where: { id: loanId },
    data: {
      annualInterestRate: d.annualInterestRatePct / 100,
      originationFeeRate: d.originationFeeRatePct / 100,
      dayCountBasis: d.dayCountBasis as DayCountBasis,
      interestMethod: d.interestMethod as LoanInterestMethod,
      startDate: d.startDate,
      maturityDate: d.maturityDate,
      status: d.status as LoanStatus,
    },
  });
  revalidatePath(`/loans/${loanId}`);
  return undefined;
}

export async function addLoanTransaction(
  loanId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = loanTxnSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };
  const d = parsed.data;

  await prisma.loanTransaction.create({
    data: {
      loanId,
      type: d.type as LoanTxnType,
      amount: d.amount,
      date: d.date,
      memo: d.memo,
    },
  });
  revalidatePath(`/loans/${loanId}`);
  return undefined;
}

export async function deleteLoanTransaction(formData: FormData): Promise<void> {
  const id = String(formData.get("txnId") ?? "");
  const loanId = String(formData.get("loanId") ?? "");
  if (id) await prisma.loanTransaction.delete({ where: { id } });
  if (loanId) revalidatePath(`/loans/${loanId}`);
}

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// Salva (upsert) os valores fornecidos de um ano do empréstimo.
export async function saveLoanYear(formData: FormData): Promise<void> {
  const loanId = String(formData.get("loanId") ?? "");
  const year = Number(formData.get("year"));
  if (!loanId || !Number.isFinite(year)) return;
  const rateRaw = String(formData.get("annualRatePct") ?? "").trim();
  // Só taxa + juro pago: o principal é fonte única em LoanTransaction; os campos vestigiais de
  // principal/accrued ficam no default 0 (ver schema LoanYear).
  const data = {
    annualRatePct: rateRaw === "" ? null : num(rateRaw),
    interestPaid: num(formData.get("interestPaid")),
    note: String(formData.get("note") ?? "").trim() || null,
  };
  await prisma.loanYear.upsert({
    where: { loanId_year: { loanId, year } },
    create: { loanId, year, ...data },
    update: data,
  });
  revalidatePath(`/loans/${loanId}`);
}

export async function deleteLoanYear(formData: FormData): Promise<void> {
  const id = String(formData.get("yearId") ?? "");
  const loanId = String(formData.get("loanId") ?? "");
  if (id) await prisma.loanYear.delete({ where: { id } });
  if (loanId) revalidatePath(`/loans/${loanId}`);
}

// Importa o register (extrato do QBO, .xls/.xlsx/.csv) como o ledger de transações do
// empréstimo. Substitui as transações existentes — fielmente ao que está na planilha:
// Increase → desembolso, Decrease → amortização. Não inventa juro.
export async function importLoanRegister(
  loanId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a register file." };
  let reg;
  try {
    reg = parseLoanRegister(Buffer.from(await file.arrayBuffer()));
  } catch {
    return { error: "Could not read the file. Export the QBO account register as .xls/.xlsx/.csv." };
  }
  const usable = reg.rows.filter((r) => r.increase != null || r.decrease != null);
  if (usable.length === 0) return { error: "No transactions found in the register." };

  // Confere a soma contra o saldo final informado na planilha.
  const computed = usable.reduce((s, r) => s + (r.increase ?? 0) - (r.decrease ?? 0), 0);
  const balanceOk =
    reg.endingBalance == null || Math.abs(computed - reg.endingBalance) < 0.01;

  // Substitui o register do empréstimo de forma ATÔMICA: delete + create no mesmo $transaction, para
  // não deixar o empréstimo sem nenhuma transação se a recriação falhar.
  await prisma.$transaction([
    prisma.loanTransaction.deleteMany({ where: { loanId } }),
    prisma.loanTransaction.createMany({
      data: usable.map((r) => ({
        loanId,
        type: (r.increase != null
          ? "DISBURSEMENT"
          : "REPAYMENT_PRINCIPAL") as LoanTxnType,
        amount: r.increase ?? r.decrease ?? 0,
        date: r.date ?? new Date(),
        memo: r.memo || (r.type ? `(${r.type})` : null),
      })),
    }),
  ]);
  revalidatePath(`/loans/${loanId}`);
  return balanceOk
    ? undefined
    : { error: `Imported, but the rows sum to ${computed.toFixed(2)} vs ending balance ${reg.endingBalance} — check for a missing line.` };
}
