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

// ── Modelos (modal + histórico; log unificado no MODEL) ──────

export async function saveModel(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const id = String(formData.get("id") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };

  const data = {
    name,
    houseType: String(formData.get("houseType") ?? "MID_RANGE") as HouseType,
    buildMonths: num(formData.get("buildMonths"), 4),
    contractorFee: optNum(formData.get("contractorFee")),
    notes: String(formData.get("notes") ?? "").trim() || null,
  };

  const dup = await prisma.catalogModel.findUnique({ where: { name } });
  if (dup && dup.id !== id) return { error: `Model "${name}" already exists.` };

  if (id) {
    const before = await prisma.catalogModel.findUnique({ where: { id } });
    if (!before) return { error: "Model not found." };
    const changes = diff(
      {
        name: before.name,
        houseType: before.houseType,
        buildMonths: before.buildMonths,
        contractorFee: before.contractorFee,
        notes: before.notes,
      },
      data,
    );
    if (changes.length === 0) return { ok: true };
    await prisma.catalogModel.update({ where: { id }, data });
    await logChange("MODEL", id, data.name, "UPDATE", changes);
  } else {
    const row = await prisma.catalogModel.create({ data });
    await logChange("MODEL", row.id, data.name, "CREATE", diff(null, data));
  }
  revalidatePath(CATALOG);
  return { ok: true };
}

export async function deleteModel(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const before = await prisma.catalogModel.findUnique({ where: { id } });
  if (!before) return;
  await prisma.catalogModel.delete({ where: { id } });
  await logChange("MODEL", id, before.name, "DELETE", []);
  revalidatePath(CATALOG);
}

// Valores do modelo NUM local: venda + custo performance + custo-base contractor (o lote
// vem do location). O log entra no histórico do MODELO, com o nome do local no campo.
export async function saveModelLocation(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const modelId = String(formData.get("modelId") ?? "");
  const locationId = String(formData.get("locationId") ?? "");
  if (!modelId || !locationId) return { error: "Pick a location." };
  const salePrice = num(formData.get("salePrice"));
  if (salePrice <= 0) return { error: "Sale price must be greater than 0." };
  const costPerformance = optNum(formData.get("costPerformance"));
  const costContractor = optNum(formData.get("costContractor"));

  const [model, location, before] = await Promise.all([
    prisma.catalogModel.findUnique({ where: { id: modelId } }),
    prisma.catalogLocation.findUnique({ where: { id: locationId } }),
    prisma.catalogModelLocation.findUnique({
      where: { modelId_locationId: { modelId, locationId } },
    }),
  ]);
  if (!model || !location) return { error: "Model or location not found." };

  const changes = diff(
    before
      ? {
          [`${location.name} — sale price`]: before.salePrice,
          [`${location.name} — cost (performance)`]: before.costPerformance,
          [`${location.name} — cost (contractor base)`]: before.costContractor,
        }
      : null,
    {
      [`${location.name} — sale price`]: salePrice,
      [`${location.name} — cost (performance)`]: costPerformance,
      [`${location.name} — cost (contractor base)`]: costContractor,
    },
  );
  if (before && changes.length === 0) return { ok: true };

  await prisma.catalogModelLocation.upsert({
    where: { modelId_locationId: { modelId, locationId } },
    create: { modelId, locationId, salePrice, costPerformance, costContractor },
    update: { salePrice, costPerformance, costContractor },
  });
  await logChange("MODEL", modelId, model.name, before ? "UPDATE" : "CREATE", changes);
  revalidatePath(CATALOG);
  return { ok: true };
}

export async function deleteModelLocation(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const before = await prisma.catalogModelLocation.findUnique({
    where: { id },
    include: { model: true, location: true },
  });
  if (!before) return;
  await prisma.catalogModelLocation.delete({ where: { id } });
  await logChange("MODEL", before.modelId, before.model.name, "UPDATE", [
    { field: `${before.location.name} — removed`, from: show(before.salePrice), to: null },
  ]);
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

// ── Perfis de banco (modal + histórico + taxas customizadas) ─

function bankDataFrom(formData: FormData) {
  return {
    name: String(formData.get("name") ?? "").trim(),
    ltcBuildPct: num(formData.get("ltcBuildPct"), 80),
    ltcLandPct: num(formData.get("ltcLandPct"), 50),
    financeLand: formData.get("financeLand") === "on",
    ltvPct: num(formData.get("ltvPct"), 70),
    haircutPct: num(formData.get("haircutPct"), 5),
    perUnitCap: optNum(formData.get("perUnitCap")),
    rateType: (["FIXED", "PRIME_SPREAD", "SOFR_SPREAD"].includes(String(formData.get("rateType")))
      ? String(formData.get("rateType"))
      : "FIXED") as "FIXED" | "PRIME_SPREAD" | "SOFR_SPREAD",
    aprPct: num(formData.get("aprPct"), 12),
    indexPct: num(formData.get("indexPct")),
    spreadPct: num(formData.get("spreadPct")),
    interestBasis: (String(formData.get("interestBasis")) === "COMMITTED"
      ? "COMMITTED"
      : "DRAWN") as "DRAWN" | "COMMITTED",
    originationPct: num(formData.get("originationPct")),
    originationFlat: num(formData.get("originationFlat")),
    brokerPct: num(formData.get("brokerPct")),
    titleEscrowPct: num(formData.get("titleEscrowPct")),
    closingFeePct: num(formData.get("closingFeePct")),
    processingFee: num(formData.get("processingFee")),
    budgetReviewFee: num(formData.get("budgetReviewFee")),
    appraisalFee: num(formData.get("appraisalFee")),
    legalFee: num(formData.get("legalFee")),
    feesFinanced: formData.get("feesFinanced") === "on",
    servicingMonthly: num(formData.get("servicingMonthly")),
    inspectionFeePerDraw: num(formData.get("inspectionFeePerDraw")),
    drawProcessingFee: num(formData.get("drawProcessingFee")),
    achFeePerBatch: num(formData.get("achFeePerBatch")),
    hasInterestReserve: formData.get("hasInterestReserve") === "on",
    reserveMonths: num(formData.get("reserveMonths"), 6),
    releaseMode: (String(formData.get("releaseMode")) === "SWEEP_PCT_LAST_FULL"
      ? "SWEEP_PCT_LAST_FULL"
      : "SWEEP_FULL") as "SWEEP_FULL" | "SWEEP_PCT_LAST_FULL",
    sweepPct: num(formData.get("sweepPct"), 100),
    reconveyanceFee: num(formData.get("reconveyanceFee")),
    termMonths: Math.round(num(formData.get("termMonths"), 12)),
    extensionMonths: Math.round(num(formData.get("extensionMonths"), 6)),
    extensionFeePct: num(formData.get("extensionFeePct"), 1),
    notes: String(formData.get("notes") ?? "").trim() || null,
  };
}

export async function saveBankProfile(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const id = String(formData.get("id") ?? "").trim();
  const data = bankDataFrom(formData);
  if (!data.name) return { error: "Bank name is required." };

  const dup = await prisma.bankProfile.findUnique({ where: { name: data.name } });
  if (dup && dup.id !== id) return { error: `Bank "${data.name}" already exists.` };

  if (id) {
    const before = await prisma.bankProfile.findUnique({ where: { id } });
    if (!before) return { error: "Bank not found." };
    const changes = diff(
      Object.fromEntries(Object.keys(data).map((k) => [k, (before as Record<string, unknown>)[k]])),
      data,
    );
    if (changes.length === 0) return { ok: true };
    await prisma.bankProfile.update({ where: { id }, data });
    await logChange("BANK", id, data.name, "UPDATE", changes);
  } else {
    const row = await prisma.bankProfile.create({ data });
    await logChange("BANK", row.id, data.name, "CREATE", diff(null, data));
  }
  revalidatePath(CATALOG);
  return { ok: true };
}

export async function deleteBankProfile(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const inUse = await prisma.poolSimulation.count({ where: { bankProfileId: id } });
  if (inUse > 0) return; // simulações salvas referenciam o banco
  const before = await prisma.bankProfile.findUnique({ where: { id } });
  if (!before) return;
  await prisma.bankProfile.delete({ where: { id } });
  await logChange("BANK", id, before.name, "DELETE", []);
  revalidatePath(CATALOG);
}

// Taxa customizada do banco — log entra no histórico do BANCO.
export async function saveBankCustomFee(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const bankProfileId = String(formData.get("bankProfileId") ?? "");
  const name = String(formData.get("feeName") ?? "").trim();
  if (!bankProfileId || !name) return { error: "Fee name is required." };
  const timing = String(formData.get("timing") ?? "CLOSING");
  const kind = String(formData.get("kind") ?? "FLAT");
  const amountRaw = String(formData.get("amount") ?? "").replace(/,/g, "").trim();
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount === 0) return { error: "Amount must be a non-zero number." };

  const bank = await prisma.bankProfile.findUnique({ where: { id: bankProfileId } });
  if (!bank) return { error: "Bank not found." };

  await prisma.bankCustomFee.create({
    data: {
      bankProfileId,
      name,
      timing: timing as "CLOSING" | "PER_DRAW" | "PER_DRAW_BATCH" | "MONTHLY" | "PER_PAYOFF" | "FINAL",
      kind: kind as "FLAT" | "PCT_COMMITTED" | "PCT_PAYOFF",
      amount,
    },
  });
  await logChange("BANK", bankProfileId, bank.name, "UPDATE", [
    { field: `custom fee: ${name} (${timing}, ${kind})`, from: null, to: String(amount) },
  ]);
  revalidatePath(CATALOG);
  return { ok: true };
}

export async function deleteBankCustomFee(formData: FormData): Promise<void> {
  const id = String(formData.get("feeId") ?? "");
  if (!id) return;
  const fee = await prisma.bankCustomFee.findUnique({ where: { id }, include: { bankProfile: true } });
  if (!fee) return;
  await prisma.bankCustomFee.delete({ where: { id } });
  await logChange("BANK", fee.bankProfileId, fee.bankProfile.name, "UPDATE", [
    { field: `custom fee: ${fee.name}`, from: show(fee.amount), to: null },
  ]);
  revalidatePath(CATALOG);
}

// ── Cenários de buffer (modal + histórico) ───────────────────

const CORE_SCENARIOS = new Set(["OPT", "REAL", "CONS"]);

export async function saveScenario(
  _prev: CatalogFormState,
  formData: FormData,
): Promise<CatalogFormState> {
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  const name = String(formData.get("name") ?? "").trim() || code;
  if (!code) return { error: "Code is required." };
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

  const before = await prisma.bufferScenario.findUnique({ where: { code } });
  if (before) {
    const changes = diff(
      {
        name: before.name,
        salePriceBufferPct: before.salePriceBufferPct,
        constructionCostBufferPct: before.constructionCostBufferPct,
        lotCostBufferPct: before.lotCostBufferPct,
        closingFeePct: before.closingFeePct,
        contingencyReservePct: before.contingencyReservePct,
        landAcquisitionDays: before.landAcquisitionDays,
        constructionDurationBufferM: before.constructionDurationBufferM,
        salesAbsorptionMonths: before.salesAbsorptionMonths,
        emdPct: before.emdPct,
        stressSlippagePct: before.stressSlippagePct,
        sortOrder: before.sortOrder,
      },
      data,
    );
    if (changes.length === 0) return { ok: true };
    await prisma.bufferScenario.update({ where: { code }, data });
    await logChange("SCENARIO", code, name, "UPDATE", changes);
  } else {
    await prisma.bufferScenario.create({ data: { code, ...data } });
    await logChange("SCENARIO", code, name, "CREATE", diff(null, data));
  }
  revalidatePath(CATALOG);
  return { ok: true };
}

// Só cenários customizados podem ser apagados — OPT/REAL/CONS são o padrão do sistema.
export async function deleteScenario(formData: FormData): Promise<void> {
  const code = String(formData.get("code") ?? "").trim().toUpperCase();
  if (!code || CORE_SCENARIOS.has(code)) return;
  const before = await prisma.bufferScenario.findUnique({ where: { code } });
  if (!before) return;
  const inUse = await prisma.poolSimulation.count({ where: { scenarioCode: code } });
  if (inUse > 0) return; // simulações salvas referenciam o cenário
  await prisma.bufferScenario.delete({ where: { code } });
  await logChange("SCENARIO", code, before.name, "DELETE", []);
  revalidatePath(CATALOG);
}
