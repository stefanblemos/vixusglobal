"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// Registra (ou atualiza) a apuração estadual de uma empresa/ano. Idempotente por
// (empresa, estado, ano) — re-enviar atualiza os valores em vez de duplicar.
export async function saveStateTaxFiling(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "");
  const jurisdiction = (String(formData.get("jurisdiction") ?? "FL").trim() || "FL").toUpperCase().slice(0, 4);
  const taxYear = Math.trunc(num(formData.get("taxYear")));
  if (!companyId || !taxYear) return;

  const principal = num(formData.get("principal"));
  const penalty = num(formData.get("penalty"));
  const interest = num(formData.get("interest"));
  const paidRaw = String(formData.get("paidDate") ?? "").trim();
  const paidDate = /^\d{4}-\d{2}-\d{2}$/.test(paidRaw) ? new Date(`${paidRaw}T00:00:00Z`) : null;
  const source = String(formData.get("source") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  await prisma.stateTaxFiling.upsert({
    where: { companyId_jurisdiction_taxYear: { companyId, jurisdiction, taxYear } },
    create: { companyId, jurisdiction, taxYear, principal, penalty, interest, paidDate, source, note },
    update: { principal, penalty, interest, paidDate, source, note },
  });
  revalidatePath("/florida");
}

export async function deleteStateTaxFiling(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.stateTaxFiling.delete({ where: { id } });
  revalidatePath("/florida");
}
