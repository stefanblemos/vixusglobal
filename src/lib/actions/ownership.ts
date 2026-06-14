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
  const { ownedCompanyId, owner, percentage, shareClass } = parsed.data;
  const [ownerType, ownerId] = owner.split(/:(.+)/) as ["party" | "company", string];

  await prisma.ownership.create({
    data: {
      ownedCompanyId,
      ownerPartyId: ownerType === "party" ? ownerId : null,
      ownerCompanyId: ownerType === "company" ? ownerId : null,
      percentage,
      shareClass,
    },
  });
  revalidatePath(`/companies/${ownedCompanyId}`);
  return undefined;
}

export async function deleteOwnership(formData: FormData): Promise<void> {
  const id = String(formData.get("ownershipId") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (id) await prisma.ownership.delete({ where: { id } });
  if (companyId) revalidatePath(`/companies/${companyId}`);
}
