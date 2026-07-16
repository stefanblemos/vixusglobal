import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ReportData } from "./report-data-core";

/**
 * NÚCLEO PURO da prosa do Investment Summary (15/07): prompt, grounding e chamada à API —
 * SEM cache (o app cacheia em PoolSimulation.reportAi via wrapper report-ai.ts; no pacote
 * standalone da 4U o dev decide a própria estratégia de cache). Claude narra APENAS os
 * dados fornecidos; previsões, recomendações e números fora do input são proibidos.
 * Requer ANTHROPIC_API_KEY no ambiente (ou client próprio via parâmetro).
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
      "One closing paragraph in English tying the thesis together using ONLY figures provided (program, Expected Case, stress-tested downside, breakeven cushion vs observed market). No predictions, no superlatives.",
    ),
});

export type ReportProse = z.infer<typeof reportProseSchema> & {
  generatedAt: string;
  model: string;
};

export type ReportProseLang = "en" | "pt" | "es";

export const PROSE_MODEL = "claude-opus-4-8";

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
- Scenario language: the "Expected Case" is the base operating case (most likely outcome);
  the "Stress Case" is a deliberately adverse scenario that sizes the raise. Never call the
  Expected Case a guarantee, a promise or a target that will be achieved.
- closingRemarks: 1 paragraph closing the document — restate the program shape, the
  Expected Case figures and the stress-tested downside, and why the underwriting holds
  against the observed data (benchmarked assumptions, breakeven cushion, stress sizing).
  End without a call to action.`;

const LANG_INSTRUCTION: Record<ReportProseLang, string> = {
  en: "",
  pt: "\n- WRITE THE OUTPUT IN BRAZILIAN PORTUGUESE (pt-BR), institutional register. Keep US market terms that Brazilian investors use (permit, closing, MLS, breakeven) and scenario names as: Cenário Esperado (Expected), Cenário de Estresse (Stress), Cenário de Alta (Upside). Currency stays in US$ as given.",
  es: "\n- WRITE THE OUTPUT IN LATIN AMERICAN SPANISH (es-419), institutional register. Keep US market terms commonly used by investors (permit, closing, MLS, breakeven) and scenario names as: Escenario Esperado (Expected), Escenario de Estrés (Stress), Escenario de Alza (Upside). Currency stays in US$ as given.",
};

// Monta o payload de grounding — tudo que a IA pode citar, e nada além
export function groundingOf(d: ReportData) {
  const expected = d.scenarios.find((s) => s.code === d.baseCode)!; // REAL
  const stress = d.scenarios.find((s) => s.code === "CONS") ?? expected;
  const kpisOf = (s: typeof expected) => ({
    netIrrPct: s.irrAnnual == null ? null : Math.round(s.irrAnnual * 1000) / 10,
    equityMultiple: s.equityMultiple,
    peakCapitalUsd: Math.round(s.peakCapital),
    investorProfitUsd: Math.round(s.profit),
  });
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
      durationMonths: Math.ceil(expected.durationDays / 30),
    },
    expectedCase: kpisOf(expected),
    stressCase: kpisOf(stress),
    // histórico realizado da 4U (agregados; TIR ESTIMADA sobre datas/lucros reais)
    builderTrackRecord:
      d.trackRecord.sample.n > 0
        ? {
            sampleClosedProjects: d.trackRecord.sample.n,
            samplePeriod: d.trackRecord.sample.periodYears,
            realizedRoiPerCycleMedianPct: d.trackRecord.roiPerCyclePct.median,
            estimatedIrrMedianPct: d.trackRecord.estimatedIrrPct.median,
            conservativeFloorIrrMedianPct: d.trackRecord.conservativeFloorIrrPct.median,
            medianCycleMonths: Math.round((d.trackRecord.cycle.medianDays / 30) * 10) / 10,
            executionAtScale: d.trackRecord.execution
              ? {
                  trackedProjects: d.trackRecord.execution.trackedProjects,
                  medianBuildMonths: Math.round((d.trackRecord.execution.buildMedianDays / 30) * 10) / 10,
                  cosByYear: d.trackRecord.execution.cosByYear,
                  homesInProduction: d.trackRecord.execution.inProductionNow,
                }
              : null,
            note: "IRR figures are ESTIMATES applying the actual client payment schedule to real project dates — never call them realized IRRs. The return sample is a REPRESENTATIVE SAMPLE drawn from the Builder's complete project records (recent window by design) — never imply older projects lack records. This track record belongs to 4U Custom Homes (the Builder) — NEVER attribute the delivery history to the investment vehicle, the client's entity, or the project itself.",
          }
        : null,
    breakevenSalePriceDropPct: d.breakevenPriceDropPct, // null = >60% (vs Expected Case)
    underwritingVsMarket: d.benchmark
      .filter((b) => b.verdict !== "NO_DATA")
      .map((b) => ({
        assumption: `${b.kind === "lot" ? "lot cost" : "sale price"} — ${b.label}`,
        program: `${b.unit === "$/sf" ? "$" + b.ours + "/sf" : "$" + b.ours.toLocaleString("en-US")}`,
        marketMedianSold: b.marketMedian == null ? null : `${b.unit === "$/sf" ? "$" + b.marketMedian + "/sf" : "$" + b.marketMedian.toLocaleString("en-US")}`,
        percentileAmongSold: b.percentile,
        sampleSize: b.n,
      })),
    note: "The Expected Case is the base operating case, benchmarked against closed transactions (underwritingVsMarket); the Stress Case applies a sale-price discount and cost/timeline buffers on top of it and is the case used to size the raise. Sensitivity and breakeven are computed on the Expected Case.",
  };
}

// Gera a prosa (sem cache). Falha → null: o DOCX sai sem as seções de IA (fallback
// determinístico — a geração do documento nunca fica refém da IA).
export async function generateReportProse(
  d: ReportData,
  lang: ReportProseLang = "en",
  client: Anthropic = new Anthropic({ maxRetries: 2 }),
): Promise<ReportProse | null> {
  try {
    const resp = await client.messages.parse({
      model: PROSE_MODEL,
      max_tokens: 1500,
      messages: [
        {
          role: "user",
          content:
            PROMPT + LANG_INSTRUCTION[lang] + "\n\nDATA (the only source of truth):\n" + JSON.stringify(groundingOf(d), null, 2),
        },
      ],
      output_config: { format: zodOutputFormat(reportProseSchema) },
    });
    const parsed = resp.parsed_output;
    if (!parsed) return null;
    return { ...parsed, generatedAt: new Date().toISOString().slice(0, 10), model: PROSE_MODEL };
  } catch (e) {
    console.error("report-ai-core: geração falhou (report sai sem prosa)", e);
    return null;
  }
}
