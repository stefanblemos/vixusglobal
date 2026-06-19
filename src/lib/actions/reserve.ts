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
  const PURPOSES = ["RESERVE", "LOAN_REPAYMENT", "INTEREST", "OTHER"];
  const purposeRaw = String(formData.get("purpose") ?? "RESERVE");
  const purpose = PURPOSES.includes(purposeRaw) ? purposeRaw : "RESERVE";
  const qboRef = String(formData.get("qboRef") ?? "").trim();

  if (!companyId || !Number.isInteger(year) || ![1, 2, 3, 4].includes(quarter)) return;
  if (!Number.isFinite(amount) || amount <= 0) return;

  await prisma.reserveDeposit.create({
    data: {
      companyId,
      year,
      quarter,
      amount,
      purpose,
      qboRef: qboRef || null,
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

// Alíquotas de provisão por ano (C-corp / pass-through / Florida + isenção).
export async function setTaxRateYear(formData: FormData): Promise<void> {
  const year = Number(String(formData.get("year") ?? ""));
  if (!Number.isInteger(year)) return;
  const num = (k: string, d: number) => {
    const n = Number(String(formData.get(k) ?? "").replace(",", "."));
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const corpPct = Math.min(num("corpPct", 21), 100);
  const passPct = Math.min(num("passPct", 30), 100);
  const flPct = Math.min(num("flPct", 5.5), 100);
  const flExemption = num("flExemption", 50000);

  await prisma.taxRateYear.upsert({
    where: { year },
    update: { corpPct, passPct, flPct, flExemption },
    create: { year, corpPct, passPct, flPct, flExemption },
  });
  revalidatePath("/reserve");
  revalidatePath("/florida");
}
