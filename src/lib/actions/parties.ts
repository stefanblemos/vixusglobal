"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { partyCreateSchema } from "@/lib/validation/party";
import { Jurisdiction, PartyKind } from "@prisma/client";

export type FormState = { error?: string } | undefined;

export async function createParty(_prev: FormState, formData: FormData): Promise<FormState> {
  const parsed = partyCreateSchema.safeParse(Object.fromEntries(formData));
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const d = parsed.data;
  await prisma.party.create({
    data: {
      kind: d.kind as PartyKind,
      name: d.name,
      taxJurisdiction: d.taxJurisdiction as Jurisdiction,
      taxId: d.taxId,
      notes: d.notes,
    },
  });
  revalidatePath("/parties");
  redirect("/parties");
}

// Mescla um dono duplicado (drop) no canônico (keep): move participações, declarações e
// SSN, depois apaga o duplicado. Usado para corrigir o mesmo dono cadastrado duas vezes.
export async function mergeParties(formData: FormData): Promise<void> {
  const keepId = String(formData.get("keepId") ?? "");
  const dropId = String(formData.get("dropId") ?? "");
  if (!keepId || !dropId || keepId === dropId) return;

  const [keep, drop] = await Promise.all([
    prisma.party.findUnique({ where: { id: keepId }, select: { id: true, taxId: true } }),
    prisma.party.findUnique({ where: { id: dropId }, select: { id: true, taxId: true } }),
  ]);
  if (!keep || !drop) return;

  // Participações onde o duplicado é DONO → reaponta para o canônico (sem duplicar a mesma
  // empresa: se o canônico já tem aquela participação, descarta a do duplicado).
  const keepOwns = await prisma.ownership.findMany({
    where: { ownerPartyId: keepId },
    select: { ownedCompanyId: true, ownedPartyId: true },
  });
  const owned = new Set(keepOwns.map((o) => `${o.ownedCompanyId ?? ""}|${o.ownedPartyId ?? ""}`));
  const dropOwns = await prisma.ownership.findMany({
    where: { ownerPartyId: dropId },
    select: { id: true, ownedCompanyId: true, ownedPartyId: true },
  });
  for (const o of dropOwns) {
    const k = `${o.ownedCompanyId ?? ""}|${o.ownedPartyId ?? ""}`;
    if (owned.has(k)) await prisma.ownership.delete({ where: { id: o.id } });
    else await prisma.ownership.update({ where: { id: o.id }, data: { ownerPartyId: keepId } });
  }

  // Participações onde o duplicado é POSSUÍDO, e declarações pessoais → reaponta.
  await prisma.ownership.updateMany({ where: { ownedPartyId: dropId }, data: { ownedPartyId: keepId } });
  await prisma.personalReturn.updateMany({ where: { partyId: dropId }, data: { partyId: keepId } });

  // Preenche o SSN/Tax ID do canônico se ele não tiver e o duplicado tiver.
  if (!keep.taxId && drop.taxId) {
    await prisma.party.update({ where: { id: keepId }, data: { taxId: drop.taxId } });
  }

  await prisma.party.delete({ where: { id: dropId } });
  revalidatePath("/parties");
}
