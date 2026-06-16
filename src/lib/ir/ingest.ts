import { prisma } from "@/lib/db";
import { analyzeTaxReturnPdf } from "@/lib/ir/analyze";
import { clampPdfPages } from "@/lib/ir/pdf";
import { matchCompany } from "@/lib/qbo/match";
import { applyOwnershipFromReturn } from "@/lib/ir/apply-ownership";

export type IngestResult = { id?: string; companyId?: string | null; error?: string };

// Núcleo da ingestão de IR: extrai com a Claude, casa a empresa, guarda tudo + o PDF.
// Reutilizado pelo endpoint de upload, pela server action e por scripts.
export async function ingestTaxReturn(fileName: string, buf: Buffer): Promise<IngestResult> {
  // Para a análise, limita às primeiras 100 páginas (limite da Claude); guarda o PDF inteiro.
  const clamped = await clampPdfPages(buf, 100);

  let data;
  try {
    data = await analyzeTaxReturnPdf(clamped.buf.toString("base64"));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Analysis failed." };
  }

  const s = (v: string) => (v && v.trim() ? v.trim() : null);

  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true, taxId: true },
  });
  const companyId = s(data.companyName) ? matchCompany(data.companyName, companies) : null;

  const owners = data.owners.map((o) => ({
    name: o.name,
    taxIdLast4: maskTaxId(o.taxId),
    ownershipPct: o.ownershipPct,
    allocatedIncome: o.allocatedIncome,
    role: s(o.role),
  }));

  const fig = (k: string) => data.figures.find((f) => f.key === k)?.value ?? null;

  const created = await prisma.taxReturn.create({
    data: {
      fileName,
      companyId,
      matchedName: s(data.companyName),
      taxId: s(data.taxId),
      year: data.year,
      jurisdiction: data.jurisdiction,
      entityType: s(data.entityType),
      taxTreatment: data.taxTreatment,
      taxForm: s(data.taxForm),
      city: s(data.city),
      state: s(data.state),
      address: s(data.address),
      businessActivity: s(data.businessActivity),
      incorporationDate: s(data.incorporationDate),
      preparer: s(data.preparer),
      responsible: s(data.responsible),
      ordinaryIncome: fig("ORDINARY_INCOME"),
      totalIncome: fig("TOTAL_INCOME"),
      netIncome: fig("NET_INCOME"),
      figures: data.figures,
      confidence: data.confidence,
      summary: data.summary,
      owners,
      k1sReceived: data.k1sReceived,
      pdf: new Uint8Array(buf),
      pdfSize: buf.length,
    },
  });

  // Preenche o Tax ID (EIN) oficial da empresa, se casou e ainda não tem.
  if (companyId && s(data.taxId)) {
    const matched = companies.find((c) => c.id === companyId);
    if (matched && !matched.taxId) {
      await prisma.company.update({ where: { id: companyId }, data: { taxId: s(data.taxId) } });
    }
  }

  // Auto-monta o ownership a partir dos sócios do IR (a menos que o ano esteja travado).
  // Falha aqui não derruba a ingestão — o ownership pode ser aplicado depois.
  try {
    await applyOwnershipFromReturn({
      companyId,
      year: data.year,
      owners,
      jurisdiction: data.jurisdiction,
    });
  } catch {
    /* não-fatal */
  }

  return { id: created.id, companyId };
}

// Mantém só os últimos 4 dígitos de um SSN/CPF/EIN (dado sensível).
function maskTaxId(raw: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const last4 = digits.slice(-4);
  return digits.length >= 9 ? `***-**-${last4}` : `…${last4}`;
}
