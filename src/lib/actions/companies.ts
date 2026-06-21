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
      aliases: d.aliases,
      jurisdiction: d.jurisdiction as Jurisdiction,
      state: d.state,
      entityType: d.entityType as EntityType,
      taxId: d.taxId,
      formationDate: d.formationDate,
      closedDate: d.closedDate,
      fiscalYearEnd: d.fiscalYearEnd,
      baseCurrency: d.baseCurrency,
      relationship: d.relationship as CompanyRelationship,
      status: d.status,
      collectsSalesTax: d.collectsSalesTax,
      hasEmployees: d.hasEmployees,
      monitored: d.monitored,
      controlsTax: d.controlsTax,
      notes: d.notes,
    },
  });
  revalidatePath("/companies");
  redirect("/companies");
}

export async function updateCompany(_prev: FormState, formData: FormData): Promise<FormState> {
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "Missing company id." };
  const parsed = companyCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;
  await prisma.company.update({
    where: { id },
    data: {
      legalName: d.legalName,
      tradeName: d.tradeName,
      aliases: d.aliases,
      jurisdiction: d.jurisdiction as Jurisdiction,
      state: d.state,
      entityType: d.entityType as EntityType,
      taxId: d.taxId,
      formationDate: d.formationDate,
      closedDate: d.closedDate,
      fiscalYearEnd: d.fiscalYearEnd,
      baseCurrency: d.baseCurrency,
      relationship: d.relationship as CompanyRelationship,
      status: d.status,
      collectsSalesTax: d.collectsSalesTax,
      hasEmployees: d.hasEmployees,
      monitored: d.monitored,
      controlsTax: d.controlsTax,
      notes: d.notes,
    },
  });
  revalidatePath(`/companies/${id}`);
  revalidatePath("/companies");
  redirect(`/companies/${id}`);
}
