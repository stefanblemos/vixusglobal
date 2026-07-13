import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { prisma } from "@/lib/db";
import type { ReportData } from "@/lib/pools/report-data";

/**
 * Prosa "viva" do Investment Summary — Claude narra APENAS os dados fornecidos (ATTOM +
 * KPIs da simulação); previsões, recomendações e números fora do input são proibidos no
 * prompt. Cache por hash dos dados no PoolSimulation.reportAi: re-gera só quando o
 * extrato semanal ou a simulação mudam. Falhou a API → report sai sem a prosa (fallback
 * determinístico — a geração do documento nunca fica refém da IA).
 */

export const reportProseSchema = z.object({
  marketCommentary: z
    .array(z.string())
    .describe(
      "Exactly 2 paragraphs of sober institutional market commentary in English, narrating ONLY the ATTOM figures provided and how the program's pricing/breakeven relate to them",
    ),
  closingRemarks: z
    .string()
    .describe(
      "One closing paragraph in English tying the thesis together using ONLY figures provided (program, base case, breakeven cushion vs observed market). No predictions, no superlatives.",
    ),
});

export type ReportProse = z.infer<typeof reportProseSchema> & {
  generatedAt: string;
  model: string;
};

type CachedProse = ReportProse & { hash: string };

const MODEL = "claude-opus-4-8";

const PROMPT = `You are writing two short sections of a confidential Investment Summary for a
residential build-to-sell program in Florida, to be reviewed by a family office and its counsel.

STRICT RULES — violating any of these makes the output unusable:
- Use ONLY the figures in the JSON below. Do not introduce ANY number, statistic, trend,
  interest rate, or market fact that is not in the input. No knowledge from training data.
- No predictions, no forecasts, no recommendations, no superlatives ("exceptional",
  "outstanding"), no urgency. Sober, factual, institutional tone.
- Refer to data as "the ATTOM MLS extract of {extractDate}" when citing market figures.
- Currency in US$ rounded as given; percentages as given.
- marketCommentary: exactly 2 paragraphs. Paragraph 1: what the submarket data shows
  (absorption, days on market, price per SF, new-construction share — compare submarkets
  where meaningful). Paragraph 2: how THIS program relates to that data (its submarkets,
  scenario discounts, and the breakeven cushion versus observed conditions).
- closingRemarks: 1 paragraph closing the document — restate the program shape, the
  Conservative base case figures, and why the underwriting holds against the observed data
  (breakeven cushion, buffers). End without a call to action.

DATA (the only source of truth):
`;

function hashOf(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 24);
}

// Monta o payload de grounding — tudo que a IA pode citar, e nada além
function groundingOf(d: ReportData) {
  const cons = d.scenarios.find((s) => s.code === d.baseCode)!;
  return {
    extractDate: d.market.extractDate,
    windowDays: d.market.windowDays,
    counties: d.market.counties,
    submarkets: d.market.submarkets,
    program: {
      homes: d.base.units.length,
      cycles: d.cycles,
      locations: d.locations,
      fundingMode: d.fundingMode,
      bankName: d.bankName,
      durationMonths: Math.ceil(cons.durationDays / 30),
    },
    conservativeBaseCase: {
      netIrrPct: cons.irrAnnual == null ? null : Math.round(cons.irrAnnual * 1000) / 10,
      equityMultiple: cons.equityMultiple,
      peakCapitalUsd: Math.round(cons.peakCapital),
      investorProfitUsd: Math.round(cons.profit),
    },
    breakevenSalePriceDropPct: d.breakevenPriceDropPct, // null = >60%
    underwritingVsMarket: d.benchmark
      .filter((b) => b.verdict !== "NO_DATA")
      .map((b) => ({
        assumption: `${b.kind === "lot" ? "lot cost" : "sale price"} — ${b.label}`,
        program: `${b.unit === "$/sf" ? "$" + b.ours + "/sf" : "$" + b.ours.toLocaleString("en-US")}`,
        marketMedianSold: b.marketMedian == null ? null : `${b.unit === "$/sf" ? "$" + b.marketMedian + "/sf" : "$" + b.marketMedian.toLocaleString("en-US")}`,
        percentileAmongSold: b.percentile,
        sampleSize: b.n,
      })),
    note: "Conservative case already applies a sale-price discount and cost/timeline buffers on top of catalog values.",
  };
}

export async function getReportProse(
  simulationId: string,
  d: ReportData,
): Promise<ReportProse | null> {
  const grounding = groundingOf(d);
  const hash = hashOf(grounding);

  const sim = await prisma.poolSimulation.findUnique({
    where: { id: simulationId },
    select: { reportAi: true },
  });
  const cached = sim?.reportAi as CachedProse | null;
  if (cached?.hash === hash && cached.marketCommentary?.length) return cached;

  try {
    const client = new Anthropic({ maxRetries: 2 });
    const resp = await client.messages.parse({
      model: MODEL,
      max_tokens: 1500,
      messages: [
        { role: "user", content: PROMPT + JSON.stringify(grounding, null, 2) },
      ],
      output_config: { format: zodOutputFormat(reportProseSchema) },
    });
    const parsed = resp.parsed_output;
    if (!parsed) return cached ?? null;
    const prose: CachedProse = {
      ...parsed,
      hash,
      generatedAt: new Date().toISOString().slice(0, 10),
      model: MODEL,
    };
    await prisma.poolSimulation.update({
      where: { id: simulationId },
      data: { reportAi: prose },
    });
    return prose;
  } catch (e) {
    console.error("report-ai: geração falhou (report sai sem prosa)", e);
    // cache velho (dados de outro extrato) é melhor que nada? NÃO — citaria números
    // que não batem com a tabela do documento. Sem prosa.
    return null;
  }
}
