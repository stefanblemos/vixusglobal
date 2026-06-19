"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { categoryByKey } from "@/lib/assets/categories";

export type AssetFormState = { error?: string } | undefined;

const num = (v: FormDataEntryValue | null) => {
  const n = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

export async function createAsset(
  _prev: AssetFormState,
  formData: FormData,
): Promise<AssetFormState> {
  const companyId = String(formData.get("companyId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "OTHER");
  const acquisitionDate = String(formData.get("acquisitionDate") ?? "").trim();
  const cost = num(formData.get("cost"));

  if (!companyId) return { error: "Select a company." };
  if (!name) return { error: "Name is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acquisitionDate)) return { error: "Use a valid acquisition date." };
  if (cost <= 0) return { error: "Cost must be greater than zero." };

  const cat = categoryByKey(category);
  // Vida/método: usa o override do formulário se vier, senão o padrão da categoria.
  const recoveryRaw = String(formData.get("recoveryYears") ?? "").trim();
  const recoveryYears = recoveryRaw ? Number(recoveryRaw) : cat.recoveryYears;
  const method = cat.method;

  const section179 = num(formData.get("section179"));
  const bonusPct = num(formData.get("bonusPct"));

  await prisma.fixedAsset.create({
    data: {
      companyId,
      name,
      category,
      acquisitionDate: new Date(`${acquisitionDate}T00:00:00Z`),
      cost,
      recoveryYears,
      method,
      section179: Math.min(section179, cost),
      bonusPct: Math.max(0, Math.min(bonusPct, 100)),
      notes: String(formData.get("notes") ?? "").trim() || null,
    },
  });

  revalidatePath("/assets");
  return undefined;
}

export async function deleteAsset(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.fixedAsset.delete({ where: { id } });
  revalidatePath("/assets");
}
