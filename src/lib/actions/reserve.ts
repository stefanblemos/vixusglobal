"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { GLOBAL_RATE_KEY } from "@/lib/tax/reserve";

// Define a alíquota de reserva (default global ou override por empresa).
// companyId vazio/"GLOBAL" = default; vazio o rate numa empresa = remove o override.
export async function setReserveRate(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "").trim() || GLOBAL_RATE_KEY;
  const raw = String(formData.get("ratePct") ?? "").trim();

  if (raw === "" && companyId !== GLOBAL_RATE_KEY) {
    // limpa o override → empresa volta a usar o default
    await prisma.taxReserveRate.deleteMany({ where: { companyId } });
    revalidatePath("/reserve");
    return;
  }

  const rate = Number(raw.replace(",", "."));
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) return;

  await prisma.taxReserveRate.upsert({
    where: { companyId },
    update: { ratePct: rate },
    create: { companyId, ratePct: rate },
  });
  revalidatePath("/reserve");
}
