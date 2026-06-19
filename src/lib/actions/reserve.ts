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

// Registra um aporte real na conta-reserva (funded). Quarter 1-4.
export async function addReserveDeposit(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "").trim();
  const year = Number(String(formData.get("year") ?? ""));
  const quarter = Number(String(formData.get("quarter") ?? ""));
  const amount = Number(String(formData.get("amount") ?? "").replace(/[^0-9.\-]/g, ""));
  const depositedRaw = String(formData.get("depositedAt") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (!companyId || !Number.isInteger(year) || ![1, 2, 3, 4].includes(quarter)) return;
  if (!Number.isFinite(amount) || amount <= 0) return;

  await prisma.reserveDeposit.create({
    data: {
      companyId,
      year,
      quarter,
      amount,
      depositedAt: /^\d{4}-\d{2}-\d{2}$/.test(depositedRaw) ? new Date(`${depositedRaw}T00:00:00Z`) : null,
      note: note || null,
    },
  });
  revalidatePath("/reserve");
}

export async function deleteReserveDeposit(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.reserveDeposit.delete({ where: { id } });
  revalidatePath("/reserve");
}
