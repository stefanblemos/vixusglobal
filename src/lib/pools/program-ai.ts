import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Justificativa do programa montado pelo otimizador (jul/2026). A Claude narra APENAS os
 * números REAIS que o motor produziu (mix, ciclos, crescimento, TIR/lucro, absorção por
 * local) e escreve o racional — por que os modelos/locais, o ritmo de reinvestimento e os
 * riscos. Sem previsões, sem números fora do input. Requer ANTHROPIC_API_KEY.
 */

export const PROGRAM_AI_MODEL = "claude-opus-4-8";

export const programRationaleSchema = z.object({
  resumo: z
    .string()
    .describe("1 parágrafo em pt-BR: visão geral do programa — capital, horizonte, retorno esperado (TIR e lucro), forma (ondas/ciclos)."),
  mix: z
    .array(z.string())
    .describe("2 a 4 marcadores: por que ESTA combinação de modelos e locais — eficiência de capital, diversificação e absorção de mercado por local. Cite os números fornecidos."),
  crescimento: z
    .string()
    .describe("1 parágrafo: a lógica do ritmo dos ciclos (ondas iguais, ou crescentes por reinvestir o lucro) e o efeito no lucro mantendo o pico de capital. Se growth=1, explique que o lucro é distribuído a cada ciclo."),
  riscos: z
    .array(z.string())
    .describe("2 a 3 marcadores: riscos e mitigantes — saturação de absorção, concentração em um modelo/local, prazo, ou locais sem dado ATTOM."),
});

export type ProgramRationale = z.infer<typeof programRationaleSchema> & {
  generatedAt: string;
  model: string;
};

export type ProgramGrounding = {
  equityTarget: number;
  horizonMonths: number;
  fundingMode: string;
  diversity: string;
  growth: number;
  kpis: { irrAnnual: number | null; profit: number; equityMultiple: number | null; peakCapital: number; durationMonths: number };
  basket: Array<{
    location: string;
    model: string;
    housesPerCycle: number[]; // casas por ciclo (crescentes se reinvestindo)
    equityPerUnit: number;
    marginPerUnit: number;
    cycleDays: number;
    absorptionPerYear: number | null;
    absorptionSource: string;
    capConcurrent: number | null;
    overAbsorption: boolean;
  }>;
};

const PROMPT = `Você escreve a JUSTIFICATIVA de um programa residencial build-to-sell na Flórida,
montado por um otimizador, para o gestor defender a alocação ao grupo de investidores.

REGRAS ESTRITAS — violar qualquer uma torna a saída inútil:
- Use APENAS os números do JSON abaixo. NÃO invente nenhum número, taxa, tendência ou fato
  de mercado que não esteja no input. Sem conhecimento de treino.
- Sem previsões, sem promessas, sem superlativos, sem chamada para ação. Tom sóbrio e técnico.
- A TIR (irrAnnual) e o lucro (profit) são do CENÁRIO base do motor — trate como estimativa,
  nunca como garantia.
- "housesPerCycle" mostra as casas por ciclo da esteira; se crescem (growth>1), é o lucro
  reinvestido financiando mais casas nos ciclos seguintes SEM elevar o pico de capital.
- "absorptionSource" ATTOM = dado de mercado real; MANUAL = estimativa do catálogo; NONE =
  sem dado (mencione como cautela). "capConcurrent" é o teto de casas do mesmo produto por
  ciclo antes de saturar; "overAbsorption" true = a cesta passou desse teto.
- Moeda em US$ como fornecido; porcentagens como fornecidas. Escreva em pt-BR institucional.`;

export async function generateProgramRationale(
  g: ProgramGrounding,
  client: Anthropic = new Anthropic({ maxRetries: 2 }),
): Promise<ProgramRationale | null> {
  try {
    const resp = await client.messages.parse({
      model: PROGRAM_AI_MODEL,
      max_tokens: 1600,
      messages: [
        {
          role: "user",
          content: PROMPT + "\n\nDADOS (a única fonte de verdade):\n" + JSON.stringify(g, null, 2),
        },
      ],
      output_config: { format: zodOutputFormat(programRationaleSchema) },
    });
    const parsed = resp.parsed_output;
    if (!parsed) return null;
    return { ...parsed, generatedAt: new Date().toISOString().slice(0, 10), model: PROGRAM_AI_MODEL };
  } catch (e) {
    console.error("program-ai: geração da justificativa falhou", e);
    return null;
  }
}
