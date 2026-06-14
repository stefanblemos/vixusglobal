"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { companyCreateSchema } from "@/lib/validation/company";
import { EntityType, Jurisdiction, CompanyRelationship } from "@prisma/client";

export type FormState = { error?: string } | undefined;

export async function createCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = companyCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;
  await prisma.company.create({
    data: {
      legalName: d.legalName,
      tradeName: d.tradeName,
      jurisdiction: d.jurisdiction as Jurisdiction,
      state: d.state,
      entityType: d.entityType as EntityType,
      taxId: d.taxId,
      fiscalYearEnd: d.fiscalYearEnd,
      baseCurrency: d.baseCurrency,
      relationship: d.relationship as CompanyRelationship,
      notes: d.notes,
    },
  });
  revalidatePath("/companies");
  redirect("/companies");
}
