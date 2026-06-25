"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { categoryByKey } from "@/lib/assets/categories";
import { ptCategoryByKey } from "@/lib/assets/pt-categories";

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
  const regime = String(formData.get("regime") ?? "US") === "PT" ? "PT" : "US";
  const name = String(formData.get("name") ?? "").trim();
  const category = String(formData.get("category") ?? "OTHER");
  const acquisitionDate = String(formData.get("acquisitionDate") ?? "").trim();
  const cost = num(formData.get("cost"));

  if (!companyId) return { error: "Select a company." };
  if (!name) return { error: "Name is required." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(acquisitionDate)) return { error: "Use a valid acquisition date." };
  if (cost <= 0) return { error: "Cost must be greater than zero." };

  if (regime === "PT") {
    // Portugal — quotas constantes (DR 25/2009). Taxa anual + parcela de terreno.
    const cat = ptCategoryByKey(category);
    const rateRaw = String(formData.get("ratePct") ?? "").trim();
    const ratePct = rateRaw ? Number(rateRaw) : cat.ratePct;
    if (!Number.isFinite(ratePct) || ratePct <= 0) return { error: "Set a valid annual rate (%)." };
    const landValue = Math.max(0, Math.min(num(formData.get("landValue")), cost));
    await prisma.fixedAsset.create({
      data: {
        companyId,
        regime: "PT",
        name,
        category,
        acquisitionDate: new Date(`${acquisitionDate}T00:00:00Z`),
        cost,
        recoveryYears: Math.round((100 / ratePct) * 10) / 10, // vida ≈ 100/taxa
        method: "SL_PT",
        ratePct,
        landValue,
        notes: String(formData.get("notes") ?? "").trim() || null,
      },
    });
    revalidatePath("/assets");
    return undefined;
  }

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
      regime: "US",
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

// Cadastra em lote os ativos confirmados na revisão (US/MACRS). Form action (FormData) — padrão
// robusto; a detecção em si roda no server component da página (via ?detect=).
export async function createDetectedAssets(formData: FormData): Promise<void> {
  const companyId = String(formData.get("companyId") ?? "");
  const assetsJson = String(formData.get("assets") ?? "[]");
  if (!companyId) return;
  let list: { name: string; cost: number; acquisitionDate: string; category: string; recoveryYears: number; disposalDate?: string }[];
  try {
    list = JSON.parse(assetsJson);
  } catch {
    return;
  }
  const data = list
    .filter((a) => a.name && Number(a.cost) > 0 && /^\d{4}-\d{2}-\d{2}$/.test(a.acquisitionDate))
    .map((a) => {
      const cat = categoryByKey(a.category);
      return {
        companyId,
        regime: "US",
        name: String(a.name).slice(0, 200),
        category: a.category,
        acquisitionDate: new Date(`${a.acquisitionDate}T00:00:00Z`),
        cost: Number(a.cost),
        recoveryYears: Number(a.recoveryYears) || cat.recoveryYears,
        method: cat.method,
        section179: 0,
        bonusPct: 0,
        disposalDate:
          a.disposalDate && /^\d{4}-\d{2}-\d{2}$/.test(a.disposalDate)
            ? new Date(`${a.disposalDate}T00:00:00Z`)
            : null,
        notes: "from-qbo",
      };
    });
  if (data.length) await prisma.fixedAsset.createMany({ data });
  revalidatePath("/assets");
}

export async function deleteAsset(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.fixedAsset.delete({ where: { id } });
  revalidatePath("/assets");
}
