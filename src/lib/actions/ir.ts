"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { analyzeTaxReturnPdf } from "@/lib/ir/analyze";
import { matchCompany } from "@/lib/qbo/match";
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

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");

  let data;
  try {
    data = await analyzeTaxReturnPdf(base64);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Analysis failed." };
  }

  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true },
  });
  const companyId = data.companyName ? matchCompany(data.companyName, companies) : null;

  const created = await prisma.taxReturn.create({
    data: {
      fileName: file.name,
      companyId,
      matchedName: data.companyName,
      year: data.year,
      jurisdiction: data.jurisdiction,
      entityType: data.entityType,
      taxTreatment: data.taxTreatment,
      taxForm: data.taxForm,
      confidence: data.confidence,
      summary: data.summary,
      owners: data.owners,
    },
  });

  revalidatePath("/tax");
  return { id: created.id };
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
}
