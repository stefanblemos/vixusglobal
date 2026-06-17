import { prisma } from "@/lib/db";
import { analyzeTaxReturnPdf } from "@/lib/ir/analyze";
import { clampPdfPages } from "@/lib/ir/pdf";
import { matchCompany } from "@/lib/qbo/match";
import { rebuildOwnershipFromIRs } from "@/lib/ir/rebuild-ownership";

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
  // Casa por EIN primeiro (identidade da entidade). Só cai no nome se NÃO houver EIN no IR,
  // ou se o nome bater com uma empresa que não tem EIN ou tem o MESMO EIN. Se o nome parece,
  // mas o EIN é DIFERENTE, é OUTRA entidade (nova) — não força o match.
  const einDigits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");
  const irEin = einDigits(data.taxId);
  let companyId: string | null = null;
  if (irEin) {
    companyId = companies.find((c) => einDigits(c.taxId) === irEin)?.id ?? null;
  }
  if (!companyId) {
    const nameMatch = s(data.companyName) ? matchCompany(data.companyName, companies) : null;
    if (nameMatch) {
      const nmEin = einDigits(companies.find((c) => c.id === nameMatch)?.taxId);
      if (!irEin || !nmEin || nmEin === irEin) companyId = nameMatch;
    }
  }

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
      isFinalReturn: data.isFinalReturn ?? false,
      pdf: new Uint8Array(buf),
      pdfSize: buf.length,
    },
  });

  // Preenche EIN e data de abertura oficiais da empresa, se casou e ainda não tiver.
  if (companyId) {
    const matched = companies.find((c) => c.id === companyId);
    const patch: { taxId?: string; formationDate?: string } = {};
    if (s(data.taxId) && matched && !matched.taxId) patch.taxId = s(data.taxId)!;
    if (s(data.incorporationDate)) {
      const cur = await prisma.company.findUnique({
        where: { id: companyId },
        select: { formationDate: true },
      });
      if (cur && !cur.formationDate) patch.formationDate = s(data.incorporationDate)!;
    }
    if (Object.keys(patch).length > 0) {
      await prisma.company.update({ where: { id: companyId }, data: patch });
    }
  }

  // Reconstrói o ownership da empresa a partir de TODOS os IRs dela (entradas/saídas/%
  // por ano, removendo espúrios, preservando datas e anos travados). Não-fatal.
  if (companyId) {
    try {
      await rebuildOwnershipFromIRs(companyId);
    } catch {
      /* não-fatal */
    }
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
