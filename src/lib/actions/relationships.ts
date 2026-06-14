"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export type ActionResult = { ok: boolean; error?: string };

const abs = (s: string | null) => (s ? s.replace(/^-/, "") : "0");

/** Cria um empréstimo intercompany a partir de uma sugestão do import. */
export async function createLoanFromImport(input: {
  importId: string;
  importCompanyId: string;
  counterpartyCompanyId: string;
  kind: "LOAN_RECEIVABLE" | "LOAN_PAYABLE";
  amount: string | null;
}): Promise<ActionResult> {
  const lenderCompanyId =
    input.kind === "LOAN_RECEIVABLE" ? input.importCompanyId : input.counterpartyCompanyId;
  const borrowerCompanyId =
    input.kind === "LOAN_RECEIVABLE" ? input.counterpartyCompanyId : input.importCompanyId;

  if (lenderCompanyId === borrowerCompanyId) {
    return { ok: false, error: "Lender and borrower are the same company." };
  }

  const existing = await prisma.intercompanyLoan.findFirst({
    where: { lenderCompanyId, borrowerCompanyId },
  });
  if (existing) return { ok: false, error: "A loan already exists for this pair." };

  await prisma.intercompanyLoan.create({
    data: {
      lenderCompanyId,
      borrowerCompanyId,
      principal: abs(input.amount),
      annualInterestRate: "0", // terms not in the balance sheet — fill in later
      startDate: new Date(),
      notes: "Imported from QBO — interest rate and origination fee pending.",
    },
  });
  revalidatePath(`/import/${input.importId}`);
  return { ok: true };
}

/** Cria um vínculo de ownership a partir de uma sugestão do import. */
export async function createOwnershipFromImport(input: {
  importId: string;
  ownerCompanyId: string;
  ownedCompanyId: string;
  percentage: number;
}): Promise<ActionResult> {
  if (input.ownerCompanyId === input.ownedCompanyId) {
    return { ok: false, error: "A company cannot own itself." };
  }
  if (!(input.percentage > 0 && input.percentage <= 100)) {
    return { ok: false, error: "Enter an ownership % between 0 and 100." };
  }
  const existing = await prisma.ownership.findFirst({
    where: { ownerCompanyId: input.ownerCompanyId, ownedCompanyId: input.ownedCompanyId },
  });
  if (existing) return { ok: false, error: "This ownership link already exists." };

  await prisma.ownership.create({
    data: {
      ownerCompanyId: input.ownerCompanyId,
      ownedCompanyId: input.ownedCompanyId,
      percentage: input.percentage,
    },
  });
  revalidatePath(`/import/${input.importId}`);
  return { ok: true };
}

/** Cria rapidamente uma empresa para uma contraparte ainda não cadastrada. */
export async function createCompanyForCounterparty(input: {
  importId: string;
  name: string;
}): Promise<ActionResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Empty name." };

  const existing = await prisma.company.findFirst({ where: { legalName: name } });
  if (!existing) {
    await prisma.company.create({
      data: {
        legalName: name,
        jurisdiction: "US",
        entityType: "LLC",
        relationship: "MANAGED_ONLY",
        baseCurrency: "USD",
        notes: "Created from QBO import.",
      },
    });
  }
  revalidatePath(`/import/${input.importId}`);
  return { ok: true };
}
