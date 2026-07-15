import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import type { ReportData } from "@/lib/pools/report-data";
import {
  generateReportProse,
  groundingOf,
  type ReportProse,
  type ReportProseLang,
} from "@/lib/pools/report-ai-core";

/**
 * WRAPPER do report-ai (15/07): a lógica de prompt/grounding/geração mora no NÚCLEO PURO
 * (report-ai-core.ts — vai no standalone da 4U); aqui só o CACHE por hash+idioma em
 * PoolSimulation.reportAi. Re-gera só quando o extrato semanal ou a simulação mudam;
 * cache velho com hash diferente NUNCA é servido (citaria números de outro extrato).
 */

export type { ReportProse, ReportProseLang } from "@/lib/pools/report-ai-core";

type CachedProse = ReportProse & { hash: string };

function hashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

export async function getReportProse(
  simulationId: string,
  d: ReportData,
  lang: ReportProseLang = "en",
): Promise<ReportProse | null> {
  const hash = hashOf(groundingOf(d)) + ":" + lang;

  const sim = await prisma.poolSimulation.findUnique({
    where: { id: simulationId },
    select: { reportAi: true },
  });
  // cache por idioma: { en: {...}, pt: {...} } — formato antigo (flat) vale como "en"
  const raw = sim?.reportAi as Record<string, CachedProse> | (CachedProse & { marketCommentary?: string[] }) | null;
  const store: Record<string, CachedProse> =
    raw && "marketCommentary" in raw ? { en: raw as CachedProse } : ((raw as Record<string, CachedProse>) ?? {});
  const cached = store[lang] ?? null;
  if (cached?.hash === hash && cached.marketCommentary?.length) return cached;

  const generated = await generateReportProse(d, lang);
  if (!generated) return cached ?? null;

  const prose: CachedProse = { ...generated, hash };
  await prisma.poolSimulation.update({
    where: { id: simulationId },
    data: { reportAi: { ...store, [lang]: prose } },
  });
  return prose;
}
