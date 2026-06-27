"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ingestTaxReturn } from "@/lib/ir/ingest";
import { rebuildOwnershipFromIRs } from "@/lib/ir/rebuild-ownership";
import { ALL_ENTITY_TYPE_VALUES, ALL_TAX_TREATMENT_VALUES } from "@/lib/catalog";
import { EntityType, TaxTreatment } from "@prisma/client";

export type IrState = { error?: string; id?: string } | undefined;

export async function analyzeAndStoreTaxReturn(
  _prev: IrState,
  formData: FormData,
): Promise<IrState> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Choose a PDF file first." };
  if (file.type && file.type !== "application/pdf")
    return { error: "Only PDF files are supported." };

  const res = await ingestTaxReturn(file.name, Buffer.from(await file.arrayBuffer()));
  if (res.error) return { error: res.error };
  revalidatePath("/tax");
  if (res.companyId) revalidatePath(`/companies/${res.companyId}`);
  return { id: res.id };
}

// Cria ownership (carimbado pelo ano do IR) a partir dos sócios extraídos — casa
// empresa→empresa quando o sócio é uma empresa cadastrada; respeita ano travado.
export async function applyTaxReturnOwnership(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const tr = await prisma.taxReturn.findUnique({
    where: { id },
    select: { companyId: true, year: true, owners: true, jurisdiction: true },
  });
  if (!tr || !tr.companyId) return;

  const res = await rebuildOwnershipFromIRs(tr.companyId);
  revalidatePath(`/companies/${tr.companyId}`);
  revalidatePath("/tax");
  redirect(`/tax?msg=owners-${res.created}`);
}

type ManualFigure = { key: string; label: string; value: number; line: string; note: string; addedAt: string };

// Registra (ou remove, se valor vazio) um ajuste MANUAL e auditável numa figura do IR — ex.: a
// depreciação que estava no retorno mas não foi destacada/extraída. Sobrepõe a figura lida por key.
export async function setManualIrFigure(formData: FormData): Promise<void> {
  const returnId = String(formData.get("returnId") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  if (!returnId || !key) return;
  const tr = await prisma.taxReturn.findUnique({
    where: { id: returnId },
    select: { manualFigures: true, companyId: true, year: true },
  });
  if (!tr) return;
  const raw = String(formData.get("value") ?? "").replace(/[^0-9.\-]/g, "");
  const value = raw === "" ? null : Number(raw);
  const LABELS: Record<string, string> = {
    DEPRECIATION: "Depreciation",
    COST_OF_GOODS: "Cost of goods sold",
    NON_DEDUCTIBLE: "Non-deductible (M-1)",
    OTHER_INCOME: "Other income",
    TOTAL_DEDUCTIONS: "Total deductions",
    NET_INCOME: "Net income (per books)",
  };
  const label = String(formData.get("label") ?? "").trim() || LABELS[key] || key;
  const line = String(formData.get("line") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const existing = ((tr.manualFigures as ManualFigure[] | null) ?? []).filter((f) => f.key !== key);
  const next =
    value == null || !Number.isFinite(value)
      ? existing
      : [...existing, { key, label, value, line, note, addedAt: new Date().toISOString() }];
  await prisma.taxReturn.update({ where: { id: returnId }, data: { manualFigures: next } });
  if (tr.companyId) {
    revalidatePath(`/companies/${tr.companyId}`);
    if (tr.year) revalidatePath(`/companies/${tr.companyId}/year/${tr.year}`);
  }
  revalidatePath("/tax");
}

export async function removeManualIrFigure(formData: FormData): Promise<void> {
  const returnId = String(formData.get("returnId") ?? "");
  const key = String(formData.get("key") ?? "").trim();
  if (!returnId || !key) return;
  const tr = await prisma.taxReturn.findUnique({
    where: { id: returnId },
    select: { manualFigures: true, companyId: true, year: true },
  });
  if (!tr) return;
  const next = ((tr.manualFigures as ManualFigure[] | null) ?? []).filter((f) => f.key !== key);
  await prisma.taxReturn.update({ where: { id: returnId }, data: { manualFigures: next } });
  if (tr.companyId) {
    revalidatePath(`/companies/${tr.companyId}`);
    if (tr.year) revalidatePath(`/companies/${tr.companyId}/year/${tr.year}`);
  }
  revalidatePath("/tax");
}

// Apaga um IR analisado (limpeza de testes).
export async function deleteTaxReturn(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  if (id) await prisma.taxReturn.delete({ where: { id } });
  revalidatePath("/tax");
}

// Aplica a classificação extraída ao histórico de tributação por ano da empresa.
export async function applyTaxReturnClassification(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const tr = await prisma.taxReturn.findUnique({ where: { id } });
  if (!tr || !tr.companyId || !tr.year) return;

  const entityType = ALL_ENTITY_TYPE_VALUES.includes(tr.entityType ?? "")
    ? (tr.entityType as EntityType)
    : null;
  const taxTreatment = ALL_TAX_TREATMENT_VALUES.includes(tr.taxTreatment ?? "")
    ? (tr.taxTreatment as TaxTreatment)
    : null;
  if (!entityType || !taxTreatment) return;

  await prisma.companyTaxStatus.upsert({
    where: { companyId_year: { companyId: tr.companyId, year: tr.year } },
    update: { entityType, taxTreatment, notes: `From IR: ${tr.fileName}` },
    create: {
      companyId: tr.companyId,
      year: tr.year,
      entityType,
      taxTreatment,
      notes: `From IR: ${tr.fileName}`,
    },
  });
  await prisma.taxReturn.update({ where: { id }, data: { status: "APPLIED" } });
  revalidatePath("/tax");
  revalidatePath(`/companies/${tr.companyId}`);
  redirect(`/tax?msg=class-${tr.year}`);
}
