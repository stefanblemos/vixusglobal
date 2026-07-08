"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import type { HouseType } from "@prisma/client";

// CRUD dos catálogos do simulador. Locais seguem o padrão novo: linha somente leitura,
// edição via modal, e CADA save grava a trilha em CatalogChangeLog (quem mudou o quê,
// valor anterior → novo). Demais entidades ainda no padrão inline (migração gradual).

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

export type CatalogFormState = { error?: string; ok?: boolean } | undefined;

type FieldChange = { field: string; from: string | null; to: string | null };

const show = (v: unknown): string | null =>
  v == null ? null : typeof v === "object" ? String(v) : String(v);

function diff(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>,
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [field, to] of Object.entries(after)) {
    const from = before?.[field];
    if (show(from) !== show(to)) changes.push({ field, from: show(from), to: show(to) });
  }
  return changes;
}

async function logChange(
  entity: string,
  entityId: string,
  entityName: string,
  action: "CREATE" | "UPDATE" | "DELETE",
  changes: FieldChange[],
): Promise<void> {
  const session = await auth();
  await prisma.catalogChangeLog.create({
    data: {
      entity,
      entityId,
      entityName,
      action,
      changedBy: session?.user?.email ?? "unknown",
      changes: changes as object[],
    },
  });
}

// ── Locais (modal + histórico) ───────────────────────────────

export async function saveLocation(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };

  const data = {
    name,
    permitDays: Math.round(num(formData.get("permitDays"), 45)),
    lotLeadDays: Math.round(num(formData.get("lotLeadDays"), 30)),
    saleDays: Math.round(num(formData.get("saleDays"), 60)),
    lotCostEstimate: optNum(formData.get("lotCostEstimate")),
    notes: String(formData.get("notes") ?? "").trim() || null,
  };

  const dup = await prisma.catalogLocation.findUnique({ where: { name } });
  if (dup && dup.id !== id) return { error: `Location "${name}" already exists.` };

  if (id) {
    const before = await prisma.catalogLocation.findUnique({ where: { id } });
    if (!before) return { error: "Location not found." };
    const changes = diff(
      {
        name: before.name,
        permitDays: before.permitDays,
        lotLeadDays: before.lotLeadDays,
        saleDays: before.saleDays,
        lotCostEstimate: before.lotCostEstimate,
        notes: before.notes,
      },
      data,
    );
    if (changes.length === 0) return { ok: true }; // nada mudou — não polui o histórico
    await prisma.catalogLocation.update({ where: { id }, data });
    await logChange("LOCATION", id, data.name, "UPDATE", changes);
  } else {
    const row = await prisma.catalogLocation.create({ data });
    await logChange("LOCATION", row.id, data.name, "CREATE", diff(null, data));
  }
  revalidatePath(CATALOG);
  return { ok: true };
}

export async function deleteLocation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const before = await prisma.catalogLocation.findUnique({ where: { id } });
  if (!before) return;
  await prisma.catalogLocation.delete({ where: { id } });
  await logChange("LOCATION", id, before.name, "DELETE", []);
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
