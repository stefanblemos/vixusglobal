"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { companyCreateSchema } from "@/lib/validation/company";
import { EntityType, Jurisdiction, CompanyRelationship } from "@prisma/client";

export type FormState = { error?: string } | undefined;

// Marca (ou limpa) a empresa como DESCONSIDERADA declarada dentro de outra (disregarded SMLLC). Guarda:
// não pode apontar para si mesma nem encadear (a dona não pode ela mesma ser desconsiderada).
export async function setDisregardedInto(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "");
  const raw = String(formData.get("disregardedIntoId") ?? "").trim();
  const parentId = raw === "" ? null : raw;
  if (!companyId) return;
  if (parentId === companyId) throw new Error("A company cannot be disregarded into itself.");
  if (parentId) {
    const parent = await prisma.company.findUnique({ where: { id: parentId }, select: { disregardedIntoId: true } });
    if (parent?.disregardedIntoId) throw new Error("The owner is itself a disregarded entity — pick the entity that actually files the return.");
  }
  await prisma.company.update({ where: { id: companyId }, data: { disregardedIntoId: parentId } });
  revalidatePath(`/companies/${companyId}`);
  revalidatePath("/tax-preview");
  revalidatePath("/tax-audit");
}

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
