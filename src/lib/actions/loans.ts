"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { loanTermsSchema, loanTxnSchema } from "@/lib/validation/loan";
import { DayCountBasis, LoanInterestMethod, LoanStatus, LoanTxnType } from "@prisma/client";

export type FormState = { error?: string } | undefined;

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
  await prisma.loanYear.upsert({
    where: { loanId_year: { loanId, year } },
    create: {
      loanId,
      year,
      annualRatePct: rateRaw === "" ? null : num(rateRaw),
      principalAdded: num(formData.get("principalAdded")),
      principalRepaid: num(formData.get("principalRepaid")),
      interestAccrued: num(formData.get("interestAccrued")),
      interestPaid: num(formData.get("interestPaid")),
      note: String(formData.get("note") ?? "").trim() || null,
    },
    update: {
      annualRatePct: rateRaw === "" ? null : num(rateRaw),
      principalAdded: num(formData.get("principalAdded")),
      principalRepaid: num(formData.get("principalRepaid")),
      interestAccrued: num(formData.get("interestAccrued")),
      interestPaid: num(formData.get("interestPaid")),
      note: String(formData.get("note") ?? "").trim() || null,
    },
  });
  revalidatePath(`/loans/${loanId}`);
}

export async function deleteLoanYear(formData: FormData): Promise<void> {
  const id = String(formData.get("yearId") ?? "");
  const loanId = String(formData.get("loanId") ?? "");
  if (id) await prisma.loanYear.delete({ where: { id } });
  if (loanId) revalidatePath(`/loans/${loanId}`);
}
