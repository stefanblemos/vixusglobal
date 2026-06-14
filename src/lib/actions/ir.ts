"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ingestTaxReturn } from "@/lib/ir/ingest";
import { ALL_ENTITY_TYPE_VALUES, ALL_TAX_TREATMENT_VALUES } from "@/lib/catalog";
import { normalizeName } from "@/lib/qbo/match";
import { EntityType, Jurisdiction, PartyKind, TaxTreatment } from "@prisma/client";

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

// Cria ownership (carimbado pelo ano do IR) a partir dos sócios extraídos.
// Idempotente: casa/cria a Party e só adiciona quem ainda não é dono cadastrado.
export async function applyTaxReturnOwnership(formData: FormData): Promise<void> {
  const id = String(formData.get("id") ?? "");
  const tr = await prisma.taxReturn.findUnique({ where: { id } });
  if (!tr || !tr.companyId) return;

  const owners = (tr.owners as { name: string; ownershipPct: number | null }[] | null) ?? [];
  const jur = (
    ["US", "BR", "PT", "OTHER"].includes(tr.jurisdiction ?? "") ? tr.jurisdiction : "OTHER"
  ) as Jurisdiction;
  const effectiveDate = tr.year ? new Date(`${tr.year}-01-01T00:00:00Z`) : undefined;

  const parties = await prisma.party.findMany();
  const existing = await prisma.ownership.findMany({ where: { ownedCompanyId: tr.companyId } });

  let created = 0;
  for (const o of owners) {
    if (o.ownershipPct == null) continue;
    let party = parties.find((p) => normalizeName(p.name) === normalizeName(o.name));
    if (!party) {
      party = await prisma.party.create({
        data: { name: o.name, kind: PartyKind.PERSON, taxJurisdiction: jur },
      });
      parties.push(party);
    }
    if (existing.some((e) => e.ownerPartyId === party!.id)) continue; // já é dono cadastrado
    await prisma.ownership.create({
      data: {
        ownerPartyId: party.id,
        ownedCompanyId: tr.companyId,
        percentage: o.ownershipPct,
        ...(effectiveDate ? { effectiveDate } : {}),
      },
    });
    created++;
  }
  revalidatePath(`/companies/${tr.companyId}`);
  revalidatePath("/tax");
  redirect(`/tax?msg=owners-${created}`);
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
