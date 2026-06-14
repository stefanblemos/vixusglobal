"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { analyzeTaxReturnPdf } from "@/lib/ir/analyze";
import { matchCompany } from "@/lib/qbo/match";
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

  const buf = Buffer.from(await file.arrayBuffer());
  const base64 = buf.toString("base64");

  let data;
  try {
    data = await analyzeTaxReturnPdf(base64);
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Analysis failed." };
  }

  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true, taxId: true },
  });
  const companyId = data.companyName ? matchCompany(data.companyName, companies) : null;

  // Sócios: mascara o SSN/CPF (guarda só os últimos 4).
  const owners = data.owners.map((o) => ({
    name: o.name,
    taxIdLast4: maskTaxId(o.taxId),
    ownershipPct: o.ownershipPct,
    allocatedIncome: o.allocatedIncome,
    role: o.role,
  }));

  // Projeta os 3 números universais a partir das linhas (figures) para acesso rápido.
  const fig = (k: string) => data.figures.find((f) => f.key === k)?.value ?? null;

  const created = await prisma.taxReturn.create({
    data: {
      fileName: file.name,
      companyId,
      matchedName: data.companyName,
      taxId: data.taxId,
      year: data.year,
      jurisdiction: data.jurisdiction,
      entityType: data.entityType,
      taxTreatment: data.taxTreatment,
      taxForm: data.taxForm,
      city: data.city,
      state: data.state,
      address: data.address,
      businessActivity: data.businessActivity,
      incorporationDate: data.incorporationDate,
      preparer: data.preparer,
      responsible: data.responsible,
      ordinaryIncome: fig("ORDINARY_INCOME"),
      totalIncome: fig("TOTAL_INCOME"),
      netIncome: fig("NET_INCOME"),
      figures: data.figures,
      confidence: data.confidence,
      summary: data.summary,
      owners,
      pdf: buf,
      pdfSize: buf.length,
    },
  });

  // Preenche o Tax ID (EIN) oficial da empresa, se casou e ainda não tem.
  if (companyId && data.taxId) {
    const matched = companies.find((c) => c.id === companyId);
    if (matched && !matched.taxId) {
      await prisma.company.update({ where: { id: companyId }, data: { taxId: data.taxId } });
      revalidatePath(`/companies/${companyId}`);
    }
  }

  revalidatePath("/tax");
  return { id: created.id };
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

// Mantém só os últimos 4 dígitos de um SSN/CPF/EIN (dado sensível).
function maskTaxId(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const last4 = digits.slice(-4);
  return digits.length >= 9 ? `***-**-${last4}` : `…${last4}`;
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
