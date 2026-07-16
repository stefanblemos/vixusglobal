import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Extração de documentos do FINANCIAMENTO (contrato, note, settlement, draw, extrato) —
 * mesmo padrão do analisador de LOI. Um schema único; o prompt diz à IA o que procurar
 * conforme o tipo. Sentinelas para "ausente": 0 (números), "" (strings).
 */

export const loanDocExtractionSchema = z.object({
  docDate: z.string().describe("Data do documento YYYY-MM-DD; \"\" se ausente"),
  loanNumber: z.string().describe("Número do loan se houver; \"\" se ausente"),
  closingDate: z.string().describe("Data do CLOSING/fechamento do loan YYYY-MM-DD; \"\" se ausente"),
  committed: z.number().describe("Valor total/comprometido do loan $; 0 se ausente"),
  interestRatePct: z.number().describe("Taxa de juros anual % (ex.: 11.0); 0 se ausente"),
  termMonths: z.number().describe("Prazo do loan em meses; 0 se ausente"),
  maturityDate: z.string().describe("Data de vencimento/maturity YYYY-MM-DD; \"\" se ausente"),
  extensionMonths: z.number().describe("Meses de extensão possível; 0 se ausente"),
  extensionFeePct: z.number().describe("Fee da extensão em %; 0 se ausente"),
  interestReserveFinanced: z.number().describe("Interest reserve FINANCIADA no loan, $; 0 se ausente"),
  feesAtClosing: z
    .array(z.object({ name: z.string(), amount: z.number(), financed: z.boolean() }))
    .describe("Fees do fechamento em $ (origination, underwriting, title, doc, legal…); financed=true se somam ao saldo do loan"),
  drawDate: z.string().describe("SÓ p/ liberação de draw: data YYYY-MM-DD; \"\" se ausente"),
  drawAmount: z.number().describe("SÓ p/ liberação de draw: valor liberado $; 0 se ausente"),
  drawHouseAddress: z.string().describe("SÓ p/ draw: endereço da casa a que se refere; \"\" se ausente"),
  interestPeriodEnd: z.string().describe("SÓ p/ extrato mensal: fim do período YYYY-MM-DD; \"\" se ausente"),
  interestAmount: z.number().describe("SÓ p/ extrato mensal: juro cobrado no período $; 0 se ausente"),
  endingBalance: z.number().describe("Saldo devedor ao fim do período se informado, $; 0 se ausente"),
  summary: z.string().describe("UMA frase de contexto (o que é o documento e os números-chave)"),
});

export type LoanDocExtraction = z.infer<typeof loanDocExtractionSchema>;

export type ExtractKind = "AGREEMENT" | "NOTE" | "SETTLEMENT" | "DRAW" | "STATEMENT";

const FOCUS: Record<ExtractKind, string> = {
  AGREEMENT:
    "Este é um LOAN AGREEMENT (contrato de construction loan). Foque em: data do closing, valor comprometido, taxa, prazo em meses e/ou maturity date, extensão (meses e fee %), interest reserve financiada, fees do fechamento.",
  NOTE: "Esta é uma PROMISSORY NOTE. Foque em: valor do principal (committed), taxa de juros, data (closing), maturity date/prazo, extensão se prevista.",
  SETTLEMENT:
    "Este é um SETTLEMENT/CLOSING STATEMENT. Foque em: data do fechamento (closingDate) e TODOS os fees cobrados com o nome original e se foram financiados no loan (financed=true) ou pagos em caixa pelo borrower.",
  DRAW: "Esta é uma APROVAÇÃO/LIBERAÇÃO DE DRAW de construction loan. Foque em: data da liberação (drawDate), valor liberado (drawAmount) e o endereço da casa/propriedade (drawHouseAddress). Se houver inspection/draw fee cobrado nesta liberação, inclua em feesAtClosing.",
  STATEMENT:
    "Este é um EXTRATO/STATEMENT MENSAL do banco. Foque em: fim do período (interestPeriodEnd), juro cobrado no período (interestAmount) e saldo final (endingBalance).",
};

const COMMON = `Extraia com fidelidade — os valores alimentam o controle financeiro do projeto e serão
revisados por um humano antes de aplicar. Percentuais como número (2% → 2). Valores em dólares
como número puro. Datas em YYYY-MM-DD. Para o que não estiver no documento use 0 (números) ou
"" (textos) — NUNCA invente valores. Preencha somente os campos pertinentes ao tipo do documento.`;

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

export async function analyzeLoanDocPdf(base64Pdf: string, kind: ExtractKind): Promise<LoanDocExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env to enable document analysis.");
  }
  const client = new Anthropic({ maxRetries: 4 });
  const res = await withRetry(() =>
    client.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf } },
            { type: "text", text: `${FOCUS[kind]}\n\n${COMMON}` },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(loanDocExtractionSchema) },
    }),
  );
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("A extração do documento não retornou dados estruturados.");
  return parsed;
}
