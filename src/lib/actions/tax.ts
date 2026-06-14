"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { taxStatusSchema } from "@/lib/validation/tax";
import { EntityType, TaxTreatment } from "@prisma/client";

export type FormState = { error?: string } | undefined;

export async function upsertTaxStatus(
  companyId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = taxStatusSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid data." };
  const d = parsed.data;

  await prisma.companyTaxStatus.upsert({
    where: { companyId_year: { companyId, year: d.year } },
    update: {
      entityType: d.entityType as EntityType,
      taxTreatment: d.taxTreatment as TaxTreatment,
      notes: d.notes,
    },
    create: {
      companyId,
      year: d.year,
      entityType: d.entityType as EntityType,
      taxTreatment: d.taxTreatment as TaxTreatment,
      notes: d.notes,
    },
  });
  revalidatePath(`/companies/${companyId}`);
  return undefined;
}

export async function deleteTaxStatus(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (id) await prisma.companyTaxStatus.delete({ where: { id } });
  if (companyId) revalidatePath(`/companies/${companyId}`);
}
