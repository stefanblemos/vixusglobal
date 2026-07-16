import { prisma } from "@/lib/db";
import { auth } from "@/auth";
import { analyzeLoiPdf, type LoiExtraction } from "@/lib/pools/loi-analyze";

// NÚCLEO do fluxo LOI → BankProfile (15/07): extraído do uploadBankLoi do catálogo para
// ser reutilizado pelo upload de LOI DENTRO DO POOL (aba Loan — pedido do Stefan: subir o
// LOI no pool e o sistema capturar as condições). Extrai com a Claude, cria/atualiza o
// BankProfile, arquiva o PDF+JSON em BankLoi e loga no histórico do banco.

function pickFee(fees: Array<{ name: string; amount: number }>, needle: string): number | null {
  const f = fees.find((x) => x.name.toLowerCase().includes(needle));
  return f && f.amount > 0 ? f.amount : null;
}

// A extração usa sentinelas para "ausente" (0 em números, "" em strings) — o schema
// estruturado da API não comporta tantos campos nullable. has()/txt() traduzem de volta.
const has = (n: number) => n > 0;
const txt = (s: string) => (s.trim() ? s.trim() : null);

const MAPPED_FEES = ["appraisal", "legal", "processing", "feasibility", "budget review"];

export async function applyLoiToBankProfile(
  bytes: Buffer,
  fileName: string,
  targetBankId: string | null,
): Promise<{ bank: { id: string; name: string }; ex: LoiExtraction } | { error: string }> {
  let ex: LoiExtraction;
  try {
    ex = await analyzeLoiPdf(bytes.toString("base64"));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Falha na extração do LOI." };
  }

  const fees = ex.fixedFees ?? [];
  const mapped: Record<string, unknown> = {
    rateType: ex.rateType === "UNKNOWN" ? "FIXED" : ex.rateType,
    interestBasis: ex.interestBasis === "UNKNOWN" ? "DRAWN" : ex.interestBasis,
    ...(has(ex.interestRatePct) ? { aprPct: ex.interestRatePct } : {}),
    ...(has(ex.spreadPct) ? { spreadPct: ex.spreadPct } : {}),
    ...(has(ex.termMonths) ? { termMonths: Math.round(ex.termMonths) } : {}),
    ...(has(ex.maxLtcPct) ? { ltcBuildPct: ex.maxLtcPct } : {}),
    ...(has(ex.maxLtvPct) ? { ltvPct: ex.maxLtvPct, haircutPct: 0 } : {}),
    ...(has(ex.originationPct) ? { originationPct: ex.originationPct } : {}),
    ...(has(ex.brokerPct) ? { brokerPct: ex.brokerPct } : {}),
    ...(has(ex.drawFeePerInspection) ? { inspectionFeePerDraw: ex.drawFeePerInspection } : {}),
    ...(pickFee(fees, "appraisal") != null ? { appraisalFee: pickFee(fees, "appraisal") } : {}),
    ...(pickFee(fees, "legal") != null ? { legalFee: pickFee(fees, "legal") } : {}),
    ...(pickFee(fees, "processing") != null ? { processingFee: pickFee(fees, "processing") } : {}),
    ...((pickFee(fees, "feasibility") ?? pickFee(fees, "budget review")) != null
      ? { budgetReviewFee: pickFee(fees, "feasibility") ?? pickFee(fees, "budget review") }
      : {}),
    hasInterestReserve: ex.interestReserve === "FINANCED",
    // reserve financiada normalmente consome o envelope do loan (estilo BC)
    reserveInEnvelope: ex.interestReserve === "FINANCED",
    ...(ex.excessRefund !== "UNKNOWN"
      ? { overfundingMode: ex.excessRefund === "REFUNDED" ? "REFUND_AT_CLOSING" : "NONE" }
      : {}),
    ...(has(ex.interestReserveMonths) ? { reserveMonths: ex.interestReserveMonths } : {}),
    feesFinanced: ex.feesFinanced,
    notes: [
      txt(`LOI ${txt(ex.loiNumber) ?? ""} ${txt(ex.loiDate) ?? ""}`),
      txt(ex.propertyAddress) ? `propriedade: ${txt(ex.propertyAddress)}` : null,
      ex.interestReserve === "LIQUIDITY_REQUIRED" ? "Reserve exigida como LIQUIDEZ (não financiada)" : null,
      txt(ex.prepaymentPenalty) ? `prepayment: ${txt(ex.prepaymentPenalty)}` : null,
      txt(ex.expiresNote),
      txt(ex.summary),
    ]
      .filter(Boolean)
      .join(" · "),
  };

  const session = await auth();
  const changedBy = session?.user?.email ?? "unknown";

  let bank: { id: string; name: string };
  if (targetBankId) {
    const existing = await prisma.bankProfile.findUnique({ where: { id: targetBankId } });
    if (!existing) return { error: "Banco alvo não encontrado." };
    await prisma.bankProfile.update({ where: { id: existing.id }, data: mapped });
    bank = existing;
    await prisma.catalogChangeLog.create({
      data: {
        entity: "BANK",
        entityId: bank.id,
        entityName: bank.name,
        action: "UPDATE",
        changedBy,
        changes: [{ field: `LOI ${txt(ex.loiNumber) ?? ""} aplicado (AI)`, from: null, to: ex.summary }],
      },
    });
  } else {
    let name = txt(ex.bankName) ?? `LOI ${txt(ex.loiNumber) ?? fileName}`;
    if (await prisma.bankProfile.findUnique({ where: { name } }))
      name = `${name} — LOI ${txt(ex.loiNumber) ?? new Date().toISOString().slice(0, 10)}`;
    bank = await prisma.bankProfile.create({ data: { name, ...mapped } as never });
    await prisma.catalogChangeLog.create({
      data: {
        entity: "BANK",
        entityId: bank.id,
        entityName: name,
        action: "CREATE",
        changedBy,
        changes: [{ field: "criado do LOI (AI)", from: null, to: ex.summary }],
      },
    });
  }

  // fees fixos não mapeados viram taxas customizadas (sem duplicar por nome)
  const existingFees = await prisma.bankCustomFee.findMany({ where: { bankProfileId: bank.id } });
  for (const f of fees) {
    const low = f.name.toLowerCase();
    if (f.amount <= 0) continue;
    if (MAPPED_FEES.some((m) => low.includes(m))) continue;
    if (existingFees.some((e) => e.name.toLowerCase() === low)) continue;
    await prisma.bankCustomFee.create({
      data: { bankProfileId: bank.id, name: f.name, timing: "CLOSING", kind: "FLAT", amount: f.amount },
    });
  }

  await prisma.bankLoi.create({
    data: {
      bankProfileId: bank.id,
      fileName,
      pdf: new Uint8Array(bytes),
      pdfSize: bytes.length,
      loiNumber: txt(ex.loiNumber),
      loiDate: txt(ex.loiDate) ? new Date(ex.loiDate) : null,
      propertyAddress: txt(ex.propertyAddress),
      extracted: JSON.parse(JSON.stringify(ex)),
      summary: ex.summary,
    },
  });

  return { bank: { id: bank.id, name: bank.name }, ex };
}

export const loiTxt = txt;
