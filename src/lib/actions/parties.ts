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
