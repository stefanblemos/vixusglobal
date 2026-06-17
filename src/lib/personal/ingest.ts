import { prisma } from "@/lib/db";
import { analyzePersonalReturnPdf } from "@/lib/personal/analyze";
import { clampPdfPages } from "@/lib/ir/pdf";
import { looseNameMatch } from "@/lib/personal/reconcile";

export type PersonalIngestResult = { id?: string; partyId?: string | null; error?: string };

// Mantém só os 4 últimos dígitos do SSN — nunca guardamos o número completo.
const last4 = (v: string) => {
  const d = (v ?? "").replace(/\D/g, "");
  return d ? d.slice(-4) : null;
};

export async function ingestPersonalReturn(
  fileName: string,
  buf: Buffer,
  partyIdOverride?: string,
): Promise<PersonalIngestResult> {
  const clamped = await clampPdfPages(buf, 100);

  let data;
  try {
    data = await analyzePersonalReturnPdf(clamped.buf.toString("base64"));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Analysis failed." };
  }

  const s = (v: string) => (v && v.trim() ? v.trim() : null);

  const parties = await prisma.party.findMany({ select: { id: true, name: true } });
  // Casa o contribuinte (ou o cônjuge) a um Party cadastrado; override vem da aba.
  // looseNameMatch tolera a truncagem do transcript do IRS ("S BRAG LEMO" = "Stefan Braga Lemos").
  const findParty = (name: string | null) =>
    name && name.trim() ? (parties.find((p) => looseNameMatch(name, p.name))?.id ?? null) : null;
  const partyId = partyIdOverride ?? findParty(data.taxpayerName) ?? findParty(data.spouseName);

  const created = await prisma.personalReturn.create({
    data: {
      fileName,
      partyId,
      matchedName: s(data.taxpayerName),
      spouseName: s(data.spouseName),
      ssnLast4: last4(data.ssnLast4),
      spouseSsnLast4: last4(data.spouseSsnLast4),
      year: data.year,
      filingStatus: s(data.filingStatus),
      form: s(data.form),
      preparer: s(data.preparer),
      wages: data.wages,
      ordinaryDividends: data.ordinaryDividends,
      qualifiedDividends: data.qualifiedDividends,
      businessIncomeC: data.businessIncomeC,
      capitalGain: data.capitalGain,
      rentalIncome: data.rentalIncome,
      partnershipIncome: data.partnershipIncome,
      partnershipLoss: data.partnershipLoss,
      totalIncome: data.totalIncome,
      agi: data.agi,
      taxableIncome: data.taxableIncome,
      totalTax: data.totalTax,
      seTax: data.seTax,
      qbiDeduction: data.qbiDeduction,
      confidence: data.confidence,
      summary: data.summary,
      pdf: new Uint8Array(buf),
      pdfSize: buf.length,
    },
  });

  return { id: created.id, partyId };
}
