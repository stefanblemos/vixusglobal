"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function deletePersonalReturn(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.personalReturn.delete({ where: { id } });
  revalidatePath("/tax/personal");
}
