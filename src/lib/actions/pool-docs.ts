"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

// Data room do pool (Fase 3, 18/07): upload por categoria + visibilidade Interno|Portal.
// Docs dos loans são agregados read-only — aqui só o toggle de visibilidade deles.

export type FormState = { error?: string; ok?: boolean } | undefined;

const DOC_TYPES = [
  "OPERATING_AGREEMENT",
  "SUBSCRIPTION",
  "NOTE",
  "NOVATION",
  "CAP_TABLE",
  "STATEMENT",
  "DISTRIBUTION_STMT",
  "CLOSING_STMT",
  "OTHER",
] as const;

export async function uploadPoolDocument(
  poolId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const files = formData.getAll("file").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { error: "Escolha o(s) PDF(s). / Choose the PDF file(s)." };
  if (files.length > 6) return { error: "Máximo de 6 documentos por lote. / Max 6 per batch." };
  for (const f of files)
    if (f.size > 10 * 1024 * 1024) return { error: `${f.name}: PDF acima de 10MB / over 10MB.` };
  const docType = String(formData.get("docType") ?? "OTHER");
  if (!DOC_TYPES.includes(docType as (typeof DOC_TYPES)[number]))
    return { error: "Categoria inválida. / Invalid category." };
  const pool = await prisma.investmentPool.findUnique({ where: { id: poolId }, select: { id: true } });
  if (!pool) return { error: "Pool não encontrado. / Pool not found." };

  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    await prisma.poolDocument.create({
      data: { poolId, docType, fileName: file.name, pdf: bytes, pdfSize: bytes.length },
    });
  }
  revalidatePath(`/pools/${poolId}`);
  return { ok: true };
}

export async function deletePoolDocument(formData: FormData) {
  const docId = String(formData.get("docId") ?? "");
  const doc = await prisma.poolDocument.findUnique({ where: { id: docId }, select: { poolId: true } });
  if (!doc) return;
  await prisma.poolDocument.delete({ where: { id: docId } });
  revalidatePath(`/pools/${doc.poolId}`);
}

// Toggle Interno|Portal — vale p/ docs do pool E docs dos loans (a flag que o portal respeita)
export async function toggleDocPortalVisible(formData: FormData) {
  const docId = String(formData.get("docId") ?? "");
  const table = String(formData.get("table") ?? "pool");
  if (table === "loan") {
    const doc = await prisma.poolLoanDocument.findUnique({
      where: { id: docId },
      select: { portalVisible: true, loan: { select: { poolId: true } } },
    });
    if (!doc) return;
    await prisma.poolLoanDocument.update({
      where: { id: docId },
      data: { portalVisible: !doc.portalVisible },
    });
    revalidatePath(`/pools/${doc.loan.poolId}`);
  } else {
    const doc = await prisma.poolDocument.findUnique({
      where: { id: docId },
      select: { portalVisible: true, poolId: true },
    });
    if (!doc) return;
    await prisma.poolDocument.update({ where: { id: docId }, data: { portalVisible: !doc.portalVisible } });
    revalidatePath(`/pools/${doc.poolId}`);
  }
}
