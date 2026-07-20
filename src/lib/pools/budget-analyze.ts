import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Leitor de BUDGET / Schedule of Values do banco (leva 2b dos marcos #73). Normaliza
 * qualquer formato — budget detalhado (ex.: Builders Capital, ~50 linhas R-1xxxx com $) ou
 * draw schedule enxuto (ex.: 2BTrust, ~9 linhas dentro do LOI) — para linhas mapeadas aos
 * NOSSOS marcos de construção. Aceita PDF (document API) ou planilha xlsx/xlsm (extraída p/
 * texto). Devolve as linhas originais + o marco de cada uma; a proposta é revisável antes de
 * aplicar às casas (o pct = valor da linha ÷ total → drawable = pct × loan da casa).
 */

export const budgetExtractionSchema = z.object({
  currency: z.string().describe('Moeda do budget ("USD", "EUR"); "" se não estiver claro'),
  totalBudget: z
    .number()
    .describe("Total do budget/loan em $ conforme o documento; 0 se não houver (a soma das linhas será usada)"),
  retainagePct: z
    .number()
    .describe("Retenção (retainage/holdback) por draw em %, SÓ se o documento mencionar explicitamente; 0 se ausente"),
  expectedDraws: z
    .number()
    .describe("Nº de draws/disbursements previstos, SÓ se o documento listar/numerar; 0 se ausente"),
  lines: z
    .array(
      z.object({
        label: z.string().describe("Nome ORIGINAL da linha do banco (ex.: 'Foundation Concrete', 'Slab', 'Block', 'Trusses')"),
        amount: z.number().describe("Valor $ desta linha do budget; 0 se a linha não tiver valor no documento"),
        milestoneKey: z
          .string()
          .describe("A KEY do nosso marco a que esta linha corresponde (escolha da lista fornecida); \"\" se não mapear a nenhum"),
      }),
    )
    .describe("TODAS as linhas do budget/draw schedule que têm valor > 0 (custos de obra e itens soft)"),
  summary: z.string().describe("UMA frase: que documento é (banco/tipo) e o total do budget"),
});

export type BudgetExtraction = z.infer<typeof budgetExtractionSchema>;
export type MilestoneOption = { key: string; name: string; detail: string | null };

const COMMON = `Você está lendo o BUDGET (Schedule of Values) ou DRAW SCHEDULE de um construction loan
de uma incorporadora. Extraia TODAS as linhas com valor, usando o nome ORIGINAL do banco e o
valor $ de cada uma. Some as linhas para conferir o total.

Para CADA linha, escolha o marco NOSSO (milestoneKey) a que ela pertence, a partir desta lista —
mapeamento é de MUITOS-para-um (várias linhas do banco podem cair no mesmo marco; ex.: "Foundation
Concrete" + "Foundation Labor" + "Excavation" → fundação). Se uma linha for soft cost puro (plans,
permits, insurance, contingency, profit/overhead) e não corresponder a nenhuma fase física, use "".

MARCOS DISPONÍVEIS (use a key exata):
{{CATALOG}}

Regras: valores em dólares como número puro (sem $ nem vírgula). Percentuais como número (10% → 10).
NÃO invente linhas nem valores — extraia só o que está no documento. Retainage e nº de draws só se o
documento disser explicitamente (senão 0). Esta leitura será REVISADA por um humano antes de aplicar.`;

function prompt(catalog: MilestoneOption[]): string {
  const list = catalog.map((m) => `- ${m.key}: ${m.name}${m.detail ? ` (${m.detail})` : ""}`).join("\n");
  return COMMON.replace("{{CATALOG}}", list);
}

async function withRetry<T>(fn: () => Promise<T>, tries = 4): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e: unknown) {
      lastErr = e;
      const status = (e as { status?: number })?.status;
      const type = (e as { error?: { error?: { type?: string } } })?.error?.error?.type;
      const retryable =
        (typeof status === "number" && (status >= 500 || status === 429 || status === 408)) ||
        type === "overloaded_error" ||
        type === "api_error";
      if (!retryable || i === tries - 1) throw e;
      await new Promise((r) => setTimeout(r, 1500 * 2 ** i + Math.random() * 500));
    }
  }
  throw lastErr;
}

// content = document (PDF) ou texto (planilha extraída)
async function run(
  content: Anthropic.MessageParam["content"],
  catalog: MilestoneOption[],
): Promise<BudgetExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env to enable document analysis.");
  }
  const client = new Anthropic({ maxRetries: 4 });
  const res = await withRetry(() =>
    client.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 12000,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(budgetExtractionSchema) },
    }),
  );
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("A leitura do budget não retornou dados estruturados.");
  return parsed;
}

export async function analyzeBudgetPdf(base64Pdf: string, catalog: MilestoneOption[]): Promise<BudgetExtraction> {
  return run(
    [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf } },
      { type: "text", text: prompt(catalog) },
    ],
    catalog,
  );
}

export async function analyzeBudgetText(tableText: string, catalog: MilestoneOption[]): Promise<BudgetExtraction> {
  return run(
    [
      { type: "text", text: `PLANILHA DE BUDGET (extraída de xlsx, colunas separadas por tab):\n\n${tableText}` },
      { type: "text", text: prompt(catalog) },
    ],
    catalog,
  );
}

// Converte a extração (valores $) em linhas do nosso editor (pct do total → drawable).
export function toBudgetRows(ex: BudgetExtraction): {
  rows: Array<{ label: string; pct: number; amount: number; milestoneKey: string | null }>;
  total: number;
} {
  const withVal = ex.lines.filter((l) => Number(l.amount) > 0);
  const sum = withVal.reduce((s, l) => s + Number(l.amount), 0);
  const total = Number(ex.totalBudget) > 0 ? Number(ex.totalBudget) : sum;
  const rows = withVal.map((l) => ({
    label: l.label.trim(),
    amount: Math.round(Number(l.amount)),
    pct: total > 0 ? Math.round((Number(l.amount) / total) * 1000) / 10 : 0,
    milestoneKey: l.milestoneKey?.trim() ? l.milestoneKey.trim() : null,
  }));
  return { rows, total };
}
