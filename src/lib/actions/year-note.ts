"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

// Salva (ou apaga, se vazia) a nota de justificativa de uma empresa/ano.
export async function saveYearNote(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "");
  const year = Number(formData.get("year"));
  const body = String(formData.get("body") ?? "").trim();
  if (!companyId || !Number.isFinite(year)) return;

  if (body === "") {
    await prisma.companyYearNote.deleteMany({ where: { companyId, year } });
  } else {
    await prisma.companyYearNote.upsert({
      where: { companyId_year: { companyId, year } },
      create: { companyId, year, body },
      update: { body },
    });
  }
  revalidatePath(`/companies/${companyId}/year/${year}`);
}
