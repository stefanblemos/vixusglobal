"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logInvestmentAudit } from "@/lib/audit";

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
  // doc pessoal do sócio (tax center): K-1/1099/statement — só o sócio vê no portal
  const memberId = String(formData.get("memberId") ?? "").trim() || null;
  if (memberId) {
    const member = await prisma.poolMember.findUnique({ where: { id: memberId }, select: { poolId: true } });
    if (!member || member.poolId !== poolId) return { error: "Sócio inválido. / Invalid member." };
  }

  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    await prisma.poolDocument.create({
      data: { poolId, docType, fileName: file.name, pdf: bytes, pdfSize: bytes.length, memberId },
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

// Prosa IA do report mensal (mock aprovado 19/07 + mercado 19/07): gera narrativa E
// comentário de mercado de uma vez; os textos caem nos textareas p/ revisão do Stefan.
export async function generateReportNarrative(
  poolId: string,
  month: string,
): Promise<{ text?: string; market?: string; error?: string }> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: "Mês inválido. / Invalid month." };
  const { buildMonthlyReport } = await import("@/lib/pools/report-month");
  const { generateMonthProse } = await import("@/lib/pools/report-month-ai");
  const { langFromCookie, INV_LANG_COOKIE } = await import("@/lib/pools/i18n");
  const { cookies } = await import("next/headers");
  const lang = langFromCookie((await cookies()).get(INV_LANG_COOKIE)?.value);
  const data = await buildMonthlyReport(poolId, month, lang);
  if (!data) return { error: "Pool não encontrado. / Pool not found." };
  const prose = await generateMonthProse(data, lang);
  if (!prose)
    return {
      error:
        lang === "pt"
          ? "Geração falhou — os textos automáticos continuam valendo; tente de novo."
          : "Generation failed — the automatic texts still apply; try again.",
    };
  return { text: prose.narrative, market: prose.marketCommentary };
}

// Report mensal (Fase 5): publica o snapshot CONGELADO do mês no Data room (Reports,
// visibilidade Portal). Republicar o mesmo mês substitui o snapshot.
export async function publishMonthlyReport(
  poolId: string,
  month: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  if (!/^\d{4}-\d{2}$/.test(month)) return { error: "Mês inválido. / Invalid month." };
  const { buildMonthlyReport } = await import("@/lib/pools/report-month");
  const { langFromCookie, INV_LANG_COOKIE } = await import("@/lib/pools/i18n");
  const { cookies } = await import("next/headers");
  const lang = langFromCookie((await cookies()).get(INV_LANG_COOKIE)?.value);

  // pre-flight de fechamento (#64): trava a publicação se há BLOCKER, salvo confirmação
  // explícita do operador ("publicar mesmo assim")
  const { loadPreflight } = await import("@/lib/pools/preflight");
  const preflight = await loadPreflight(poolId, month, lang);
  const force = formData.get("force") === "on";
  if (preflight.blockers > 0 && !force)
    return {
      error:
        lang === "pt"
          ? `${preflight.blockers} pendência(s) bloqueiam a publicação — revise o checklist ou confirme "publicar mesmo assim".`
          : `${preflight.blockers} blocking issue(s) — review the checklist or confirm "publish anyway".`,
    };

  const data = await buildMonthlyReport(poolId, month, lang);
  if (!data) return { error: "Pool não encontrado. / Pool not found." };
  const narrative = String(formData.get("narrative") ?? "").trim();
  if (narrative) data.narrative = narrative;
  const marketCommentary = String(formData.get("marketCommentary") ?? "").trim();
  if (marketCommentary) data.marketCommentary = marketCommentary;

  const existing = await prisma.poolDocument.findFirst({
    where: { poolId, reportMonth: month },
    select: { id: true },
  });
  const doc = {
    docType: "STATEMENT",
    fileName: `Monthly Report ${data.poolCode} ${month}`,
    reportMonth: month,
    data: JSON.parse(JSON.stringify(data)),
    portalVisible: true,
  };
  if (existing) await prisma.poolDocument.update({ where: { id: existing.id }, data: doc });
  else await prisma.poolDocument.create({ data: { poolId, ...doc } });
  await logInvestmentAudit({
    poolId,
    entity: "REPORT",
    entityId: month,
    action: "PUBLISH",
    summary: `${existing ? "Republicou" : "Publicou"} report mensal ${month}${preflight.blockers > 0 ? ` (com ${preflight.blockers} pendência forçada)` : ""}`,
  });
  revalidatePath(`/pools/${poolId}`);
  revalidatePath(`/pools/${poolId}/report/${month}`);
  return { ok: true };
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
