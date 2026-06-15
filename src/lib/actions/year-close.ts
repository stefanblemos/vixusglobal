"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { buildYearSnapshot } from "@/lib/ir/year-close";

// Fecha (trava) um ano: congela a verdade de referência (sócios, tributação,
// números-chave do IR) com quem fechou. Idempotente por (companyId, year).
export async function lockYear(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "");
  const year = parseInt(String(formData.get("year") ?? ""), 10);
  if (!companyId || Number.isNaN(year)) return;

  const session = await auth();
  const lockedBy = session?.user?.email ?? "unknown";
  const snapshot = await buildYearSnapshot(companyId, year);

  await prisma.yearClose.upsert({
    where: { companyId_year: { companyId, year } },
    update: { snapshot, lockedBy, lockedAt: new Date() },
    create: { companyId, year, snapshot, lockedBy },
  });
  revalidatePath(`/companies/${companyId}/year/${year}`);
  revalidatePath(`/companies/${companyId}`);
}

// Reabre um ano (apaga a trava). Mantemos o registro de quem reabriu no log do app.
export async function unlockYear(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "");
  const year = parseInt(String(formData.get("year") ?? ""), 10);
  if (!companyId || Number.isNaN(year)) return;

  await prisma.yearClose
    .delete({ where: { companyId_year: { companyId, year } } })
    .catch(() => undefined);
  revalidatePath(`/companies/${companyId}/year/${year}`);
  revalidatePath(`/companies/${companyId}`);
}
