import Anthropic from "@anthropic-ai/sdk";
import type { ReportMonthData } from "./report-month";
import type { Lang } from "./i18n";

/**
 * Narrativa IA do report mensal (prometida no mock aprovado 19/07: "gerada dos eventos,
 * com opção de refinar via IA"). Grounding = o próprio ReportMonthData — a IA só pode
 * citar o que está no JSON. Falha → null: o botão avisa e a narrativa determinística
 * continua valendo (a publicação nunca fica refém da IA). Mesmo modelo do report de
 * investimento (report-ai-core).
 */

const MODEL = "claude-opus-4-8";

const PROMPT: Record<Lang, string> = {
  pt: `Você escreve a seção "O mês em resumo" de um Monthly Investor Report de um pool de
construção residencial (single-family, Flórida). Voz do GESTOR: sóbria, institucional,
factual — sem promessas, sem adjetivos vazios, sem exclamações.

Escreva UM parágrafo único de 4 a 7 frases, em português, cobrindo na ordem que fizer
sentido: (1) os eventos relevantes do mês (agrupe os parecidos — ex.: "os três contratos
de financiamento foram processados" em vez de listar arquivos); (2) o andamento da obra
e do cronograma; (3) a marcação (NAV/unit e a variação vs mês anterior, se houver);
(4) pontos de atenção com honestidade (ex.: runway curto e capital call sugerida);
(5) feche com o que vem a seguir ancorado na próxima distribuição prevista.

REGRAS DURAS: use SOMENTE os fatos do JSON abaixo — nunca invente números, datas ou
eventos; valores aproximados do JSON continuam aproximados (use "≈"); projeções são
"previstas/estimadas", nunca certezas; não repita o glossário nem explique siglas.
Responda APENAS com o parágrafo, sem título e sem markdown.`,
  en: `You write the "Month in summary" section of a Monthly Investor Report for a
residential construction pool (single-family, Florida). MANAGER's voice: sober,
institutional, factual — no promises, no empty adjectives, no exclamation marks.

Write ONE single paragraph of 4–7 sentences, in English, covering in whatever order
reads best: (1) the month's relevant events (group similar ones — e.g. "the three
financing agreements were processed" instead of listing files); (2) build & schedule
progress; (3) the mark (NAV/unit and the change vs the previous month, if any);
(4) points of attention stated honestly (e.g. short cash runway and the suggested
capital call); (5) close with what comes next anchored on the next projected
distribution.

HARD RULES: use ONLY facts from the JSON below — never invent numbers, dates or
events; approximate values stay approximate (use "≈"); projections are "projected/
estimated", never certainties; do not repeat the glossary or explain acronyms.
Reply with the paragraph ONLY — no title, no markdown.`,
};

// grounding enxuto: só o que a narrativa pode citar
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

export async function generateMonthNarrative(
  d: ReportMonthData,
  lang: Lang,
  client: Anthropic = new Anthropic({ maxRetries: 2 }),
): Promise<string | null> {
  try {
    const resp = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content:
            PROMPT[lang] + "\n\nJSON (única fonte de verdade / the only source of truth):\n" +
            JSON.stringify(groundingOf(d), null, 2),
        },
      ],
    });
    const text = resp.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return text || null;
  } catch (e) {
    console.error("report-month-ai: geração falhou (narrativa determinística continua)", e);
    return null;
  }
}
