"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { partyCreateSchema } from "@/lib/validation/party";
import { mergePartyById } from "@/lib/parties/merge";
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

// Liga/desliga "tomamos conta do IR (1040) desta pessoa". Desligado = fica fora da
// sequência de fechamento (ex.: sócio externo cujo IR não fazemos).
export async function setPartyControlsTax(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const controlsTax = formData.get("controlsTax") === "true";
  await prisma.party.update({ where: { id }, data: { controlsTax } });
  revalidatePath(`/parties/${id}`);
  revalidatePath("/closing-sequence");
}

// Mescla um dono duplicado (drop) no canônico (keep). Núcleo em @/lib/parties/merge.
export async function mergeParties(formData: FormData): Promise<void> {
  const keepId = String(formData.get("keepId") ?? "");
  const dropId = String(formData.get("dropId") ?? "");
  await mergePartyById(keepId, dropId);
  revalidatePath("/parties");
  revalidatePath(`/parties/${keepId}`);
}
