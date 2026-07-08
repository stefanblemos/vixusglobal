"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { HouseType } from "@prisma/client";

// CRUD dos catálogos do simulador. Ações void (forms server-side); números aceitam
// vírgulas; campos vazios viram null onde o schema permite.

const num = (v: FormDataEntryValue | null, fallback = 0) => {
  const n = Number(String(v ?? "").replace(/,/g, "").trim());
  return Number.isFinite(n) ? n : fallback;
};
const optNum = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").replace(/,/g, "").trim();
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const CATALOG = "/pools/catalog";

// ── Locais ───────────────────────────────────────────────────

export async function saveLocation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const data = {
    name,
    permitDays: Math.round(num(formData.get("permitDays"), 45)),
    lotLeadDays: Math.round(num(formData.get("lotLeadDays"), 30)),
    saleDays: Math.round(num(formData.get("saleDays"), 60)),
    lotCostEstimate: optNum(formData.get("lotCostEstimate")),
  };
  if (id) await prisma.catalogLocation.update({ where: { id }, data });
  else await prisma.catalogLocation.create({ data });
  revalidatePath(CATALOG);
}

export async function deleteLocation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.catalogLocation.delete({ where: { id } });
  revalidatePath(CATALOG);
}

// ── Modelos ──────────────────────────────────────────────────

export async function saveModel(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const data = {
    name,
    houseType: String(formData.get("houseType") ?? "MID_RANGE") as HouseType,
    buildMonths: num(formData.get("buildMonths"), 4),
    directCost: num(formData.get("directCost")),
    contractorFee: optNum(formData.get("contractorFee")),
  };
  if (id) await prisma.catalogModel.update({ where: { id }, data });
  else await prisma.catalogModel.create({ data });
  revalidatePath(CATALOG);
}

export async function deleteModel(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.catalogModel.delete({ where: { id } });
  revalidatePath(CATALOG);
}

// Disponibiliza (ou atualiza) um modelo num local, com preço de venda daquele local.
export async function saveModelLocation(formData: FormData): Promise<void> {
  const modelId = String(formData.get("modelId") ?? "");
  const locationId = String(formData.get("locationId") ?? "");
  if (!modelId || !locationId) return;
  const salePrice = num(formData.get("salePrice"));
  const lotCost = optNum(formData.get("lotCost"));
  await prisma.catalogModelLocation.upsert({
    where: { modelId_locationId: { modelId, locationId } },
    create: { modelId, locationId, salePrice, lotCost },
    update: { salePrice, lotCost },
  });
  revalidatePath(CATALOG);
}

export async function deleteModelLocation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.catalogModelLocation.delete({ where: { id } });
  revalidatePath(CATALOG);
}

// ── Fee por tipo de casa ─────────────────────────────────────

export async function saveHouseTypeFee(formData: FormData): Promise<void> {
  const type = String(formData.get("type") ?? "") as HouseType;
  if (!type) return;
  await prisma.houseTypeFee.upsert({
    where: { type },
    create: { type, fee: num(formData.get("fee")) },
    update: { fee: num(formData.get("fee")) },
  });
  revalidatePath(CATALOG);
}

// ── Perfis de banco ──────────────────────────────────────────

export async function saveBankProfile(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const data = {
    name,
    ltcBuildPct: num(formData.get("ltcBuildPct"), 80),
    ltcLandPct: num(formData.get("ltcLandPct"), 50),
    financeLand: formData.get("financeLand") === "on",
    ltvPct: num(formData.get("ltvPct"), 70),
    haircutPct: num(formData.get("haircutPct"), 5),
    perUnitCap: optNum(formData.get("perUnitCap")),
    aprPct: num(formData.get("aprPct"), 12),
    originationPct: num(formData.get("originationPct"), 1),
    originationFlat: num(formData.get("originationFlat")),
    closingFeePct: num(formData.get("closingFeePct"), 3),
    appraisalFee: num(formData.get("appraisalFee"), 1500),
    legalFee: num(formData.get("legalFee"), 1800),
    inspectionFeePerDraw: num(formData.get("inspectionFeePerDraw"), 205),
    servicingMonthly: num(formData.get("servicingMonthly"), 95),
    hasInterestReserve: formData.get("hasInterestReserve") === "on",
    feesFinanced: formData.get("feesFinanced") === "on",
  };
  if (id) await prisma.bankProfile.update({ where: { id }, data });
  else await prisma.bankProfile.create({ data });
  revalidatePath(CATALOG);
}

export async function deleteBankProfile(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.bankProfile.delete({ where: { id } });
  revalidatePath(CATALOG);
}

// ── Cenários de buffer ───────────────────────────────────────

export async function saveScenario(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim() || code;
  if (!code) return;
  const data = {
    name,
    salePriceBufferPct: num(formData.get("salePriceBufferPct")),
    constructionCostBufferPct: num(formData.get("constructionCostBufferPct")),
    lotCostBufferPct: num(formData.get("lotCostBufferPct")),
    closingFeePct: num(formData.get("closingFeePct"), 8),
    contingencyReservePct: num(formData.get("contingencyReservePct"), 5),
    landAcquisitionDays: Math.round(num(formData.get("landAcquisitionDays"), 20)),
    constructionDurationBufferM: num(formData.get("constructionDurationBufferM")),
    salesAbsorptionMonths: optNum(formData.get("salesAbsorptionMonths")),
    emdPct: num(formData.get("emdPct"), 10),
    stressSlippagePct: num(formData.get("stressSlippagePct")),
    sortOrder: Math.round(num(formData.get("sortOrder"), 9)),
  };
  await prisma.bufferScenario.upsert({ where: { code }, create: { code, ...data }, update: data });
  revalidatePath(CATALOG);
}
