import { prisma } from "@/lib/db";
import { analyzeCorporateDocPdf, CORP_DOC_TYPES } from "@/lib/corporate/analyze";
import { clampPdfPages } from "@/lib/ir/pdf";
import { matchCompany } from "@/lib/qbo/match";

export type CorpIngestResult = { id?: string; companyId?: string | null; error?: string };

// Núcleo da ingestão de documento societário: extrai com a Claude, casa a empresa, guarda.
// docTypeHint vem do que o usuário escolheu no upload (sobrepõe a detecção da IA).
export async function ingestCorporateDoc(
  fileName: string,
  buf: Buffer,
  docTypeHint?: string,
  companyIdOverride?: string,
): Promise<CorpIngestResult> {
  const clamped = await clampPdfPages(buf, 100);

  let data;
  try {
    data = await analyzeCorporateDocPdf(clamped.buf.toString("base64"));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Analysis failed." };
  }

  const s = (v: string) => (v && v.trim() ? v.trim() : null);
  const docType =
    docTypeHint && CORP_DOC_TYPES.includes(docTypeHint as (typeof CORP_DOC_TYPES)[number])
      ? docTypeHint
      : data.docType;

  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true, taxId: true },
  });
  // Anexa à empresa da aba (override); senão casa por nome.
  const companyId =
    companyIdOverride ?? (s(data.companyName) ? matchCompany(data.companyName, companies) : null);

  const created = await prisma.corporateDoc.create({
    data: {
      fileName,
      companyId,
      matchedName: s(data.companyName),
      docType,
      year: data.year,
      jurisdiction: data.jurisdiction,
      state: s(data.state),
      docNumber: s(data.docNumber),
      taxId: s(data.taxId),
      formationDate: s(data.formationDate),
      filingDate: s(data.filingDate),
      status: s(data.status),
      registeredAgent: s(data.registeredAgentName)
        ? { name: data.registeredAgentName, address: s(data.registeredAgentAddress) ?? "" }
        : undefined,
      principalAddress: s(data.principalAddress),
      mailingAddress: s(data.mailingAddress),
      people: data.people,
      confidence: data.confidence,
      summary: data.summary,
      pdf: new Uint8Array(buf),
      pdfSize: buf.length,
    },
  });

  // Backfill do EIN da empresa se casou e ainda não tem.
  if (companyId && s(data.taxId)) {
    const matched = companies.find((c) => c.id === companyId);
    if (matched && !matched.taxId) {
      await prisma.company.update({ where: { id: companyId }, data: { taxId: s(data.taxId) } });
    }
  }

  return { id: created.id, companyId };
}
