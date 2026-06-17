"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

export async function deleteCorporateDoc(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const companyId = String(formData.get("companyId") ?? "");
  if (id) await prisma.corporateDoc.delete({ where: { id } });
  if (companyId) revalidatePath(`/companies/${companyId}`);
}
