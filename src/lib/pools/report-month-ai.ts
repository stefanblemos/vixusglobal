import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { ReportMonthData } from "./report-month";
import type { Lang } from "./i18n";

/**
 * Prosa IA do report mensal (mock aprovado 19/07 + pedido 19/07: mesmo tratamento na
 * seção de mercado). Gera DOIS textos de uma vez — narrativa do mês e comentário de
 * mercado — com grounding EXCLUSIVO no ReportMonthData. Falha → null: os textos
 * determinísticos continuam valendo (a publicação nunca fica refém da IA).
 */

const MODEL = "claude-opus-4-8";

const proseSchema = z.object({
  narrative: z.string().describe("the single-paragraph month summary"),
  marketCommentary: z.string().describe("the single-paragraph market commentary"),
});
export type MonthProse = z.infer<typeof proseSchema>;

const PROMPT: Record<Lang, string> = {
  pt: `Você escreve duas seções de um Monthly Investor Report de um pool de construção
residencial (single-family, Flórida). Voz do GESTOR: sóbria, institucional, factual —
sem promessas, sem adjetivos vazios, sem exclamações. Responda em português.

1) "narrative" — UM parágrafo de 4 a 7 frases sobre o mês: eventos relevantes (agrupe
os parecidos), andamento de obra/cronograma, a marcação (NAV/unit e variação vs mês
anterior, se houver), pontos de atenção com honestidade (ex.: runway curto e capital
call sugerida), fechando com o que vem a seguir ancorado na próxima distribuição
prevista.

2) "marketCommentary" — UM parágrafo de 3 a 5 frases interpretando os faróis de
mercado (market.green/amber/red e market.notes): o que significam os avisos casa a
casa (acima do p90 = preço planejado no topo da distribuição de vendidas; acima do
teto = acima do maior valor observado; margem fina = pouco colchão), por que a
projeção líquida usa o preço A MERCADO e o efeito disso vs o plano
(endPerUnitNetProjection × plano), e o que o gestor fará a respeito SOMENTE se os
dados indicarem (ex.: monitorar, revisar preço) — sem inventar ações.

REGRAS DURAS: use SOMENTE os fatos do JSON — nunca invente números, datas, eventos ou
ações; aproximados continuam aproximados (use "≈"); projeções são "previstas/
estimadas"; não explique siglas (há glossário). Sem títulos e sem markdown.`,
  en: `You write two sections of a Monthly Investor Report for a residential
construction pool (single-family, Florida). MANAGER's voice: sober, institutional,
factual — no promises, no empty adjectives, no exclamation marks. Reply in English.

1) "narrative" — ONE paragraph of 4–7 sentences about the month: relevant events
(group similar ones), build & schedule progress, the mark (NAV/unit and change vs
previous month, if any), points of attention stated honestly (e.g. short cash runway
and the suggested capital call), closing with what comes next anchored on the next
projected distribution.

2) "marketCommentary" — ONE paragraph of 3–5 sentences interpreting the market
lights (market.green/amber/red and market.notes): what the house-level flags mean
(above p90 = planned price at the top of the sold distribution; above ceiling =
above the highest observed sale; thin margin = little cushion), why the net
projection prices unsold homes AT MARKET and its effect vs plan
(endPerUnitNetProjection × plan), and what the manager will do about it ONLY if the
data supports it (e.g. monitor, reprice) — never invent actions.

HARD RULES: use ONLY facts from the JSON — never invent numbers, dates, events or
actions; approximate values stay approximate (use "≈"); projections are "projected/
estimated"; do not explain acronyms (there is a glossary). No titles, no markdown.`,
};

// grounding enxuto: só o que a prosa pode citar
function groundingOf(d: ReportMonthData) {
  return {
    pool: d.poolName,
    month: d.month,
    kpis: d.kpis,
    events: d.events.map((e) => e.text),
    scheduleMilestones: d.schedule,
    risk: d.risk,
    market: d.market,
    distributions: d.dist,
    endPerUnitNetProjection: d.chart.end,
    unitPar: d.chart.par,
  };
}

export async function generateMonthProse(
  d: ReportMonthData,
  lang: Lang,
  client: Anthropic = new Anthropic({ maxRetries: 2 }),
): Promise<MonthProse | null> {
  try {
    const resp = await client.messages.parse({
      model: MODEL,
      max_tokens: 900,
      messages: [
        {
          role: "user",
          content:
            PROMPT[lang] + "\n\nJSON (única fonte de verdade / the only source of truth):\n" +
            JSON.stringify(groundingOf(d), null, 2),
        },
      ],
      output_config: { format: zodOutputFormat(proseSchema) },
    });
    return resp.parsed_output ?? null;
  } catch (e) {
    console.error("report-month-ai: geração falhou (textos determinísticos continuam)", e);
    return null;
  }
}
