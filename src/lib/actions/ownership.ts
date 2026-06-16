"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ownershipCreateSchema } from "@/lib/validation/ownership";

export type FormState = { error?: string } | undefined;

export async function createOwnership(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = ownershipCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const { ownedCompanyId, owner, percentage, shareClass, effectiveDate } = parsed.data;
  const [ownerType, ownerId] = owner.split(/:(.+)/) as ["party" | "company", string];

  await prisma.ownership.create({
    data: {
      ownedCompanyId,
      ownerPartyId: ownerType === "party" ? ownerId : null,
      ownerCompanyId: ownerType === "company" ? ownerId : null,
      percentage,
      shareClass,
      ...(effectiveDate ? { effectiveDate: new Date(`${effectiveDate}T00:00:00Z`) } : {}),
    },
  });
  revalidatePath(`/companies/${ownedCompanyId}`);
  return undefined;
}

// Encerra um vínculo numa data (entrada/saída de sócio) — preserva o histórico,
// diferente de deleteOwnership (que apaga o registro, p/ corrigir erro).
export async function endOwnership(formData: FormData): Promise<void> {
  const id = String(formData.get("ownershipId") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  const endDate = String(formData.get("endDate") ?? "").trim();
  if (id && /^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
    await prisma.ownership.update({
      where: { id },
      data: { endDate: new Date(`${endDate}T00:00:00Z`) },
    });
  }
  if (companyId) revalidatePath(`/companies/${companyId}`);
}

// Reabre um vínculo encerrado (limpa o endDate) — p/ corrigir uma saída lançada errada.
export async function reopenOwnership(formData: FormData): Promise<void> {
  const id = String(formData.get("ownershipId") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (id) await prisma.ownership.update({ where: { id }, data: { endDate: null } });
  if (companyId) revalidatePath(`/companies/${companyId}`);
}

export async function deleteOwnership(formData: FormData): Promise<void> {
  const id = String(formData.get("ownershipId") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (id) await prisma.ownership.delete({ where: { id } });
  if (companyId) revalidatePath(`/companies/${companyId}`);
}
