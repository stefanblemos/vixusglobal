import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

/**
 * Extração de Letter of Intent (LOI) de construction lender via Claude — mesmo padrão do
 * analisador de IRs. O resultado pré-preenche um BankProfile (revisado pelo usuário) e o
 * LOI fica arquivado com o JSON completo.
 */

// Sem campos nullable: a API estruturada limita uniões/anyOf a 16 por schema. Ausente =
// 0 (números), "" (strings), UNKNOWN (enums) — o prompt instrui e o mapeamento trata.
export const loiExtractionSchema = z.object({
  bankName: z.string().describe("Nome do lender/banco que emitiu o LOI"),
  loiNumber: z.string().describe("Número do LOI se houver (ex.: #16804); \"\" se ausente"),
  loiDate: z.string().describe("Data de emissão YYYY-MM-DD; \"\" se ausente"),
  propertyAddress: z.string().describe("Endereço da propriedade com cidade; \"\" se ausente"),
  totalLoanAmount: z.number().describe("$; 0 se ausente"),
  constructionBudget: z.number().describe("$; 0 se ausente"),
  afterRepairValue: z.number().describe("ARV / after repair value, $; 0 se ausente"),
  interestRatePct: z.number().describe("Taxa de juros anual em % (ex.: 9.0); 0 se ausente"),
  rateType: z.enum(["FIXED", "PRIME_SPREAD", "SOFR_SPREAD", "UNKNOWN"]),
  spreadPct: z.number().describe("Spread sobre o índice se taxa indexada; 0 se ausente"),
  interestBasis: z
    .enum(["DRAWN", "COMMITTED", "UNKNOWN"])
    .describe("DRAWN = non-Dutch (juro só sobre o sacado); COMMITTED = Dutch (sobre o total)"),
  termMonths: z.number().describe("Prazo em meses; 0 se ausente"),
  maxLtcPct: z.number().describe("Max LTC em % (loan-to-cost); 0 se ausente"),
  maxLtvPct: z.number().describe("Max LTV/LARV em % (sobre ARV); 0 se ausente"),
  originationPct: z.number().describe("%; 0 se ausente"),
  brokerPct: z.number().describe("%; 0 se ausente"),
  drawFeePerInspection: z.number().describe("Fee por draw/inspeção, $ fixo; 0 se ausente"),
  interestReserve: z
    .enum(["FINANCED", "LIQUIDITY_REQUIRED", "NONE", "UNKNOWN"])
    .describe("FINANCED = embutida no loan; LIQUIDITY_REQUIRED = exigida como liquidez do borrower"),
  interestReserveMonths: z.number().describe("Meses de juros na reserve/liquidez; 0 se ausente"),
  excessRefund: z
    .enum(["REFUNDED", "NOT_ALLOWED", "UNKNOWN"])
    .describe("Se o loan exceder custos+fees (cash-out): REFUNDED = excedente devolvido ao borrower no closing; NOT_ALLOWED = banco não desembolsa além do custo"),
  prepaymentPenalty: z.string().describe("Penalidade de pré-pagamento; \"\" se ausente"),
  exitFeeNote: z.string().describe("Exit fee se houver; \"\" se ausente"),
  feesFinanced: z
    .boolean()
    .describe("true se os closing costs são financiados no loan; false se pagos em caixa ou se o documento não disser"),
  fixedFees: z
    .array(z.object({ name: z.string(), amount: z.number() }))
    .describe("Fees fixos em $ (underwriting, appraisal, legal, processing, feasibility, other…)"),
  liquidityRequired: z.number().describe("Liquidez exigida para aprovação, $; 0 se ausente"),
  expiresNote: z.string().describe("Prazo de validade do LOI; \"\" se ausente"),
  summary: z.string().describe("UMA frase de contexto"),
});

export type LoiExtraction = z.infer<typeof loiExtractionSchema>;

const PROMPT = `Você está lendo uma LETTER OF INTENT (LOI) de um construction lender americano
para um projeto residencial. Extraia os termos do financiamento com fidelidade — são a base
de um comparador de bancos. Atenção:
- "Non-Dutch" / "interest only on drawn balance" → interestBasis DRAWN; "Dutch" → COMMITTED.
- Interest reserve "to be shown as liquidity" ou somada à liquidez exigida → LIQUIDITY_REQUIRED;
  reserve embutida/financiada no loan → FINANCED.
- Percentuais como número (1.75% → 1.75). Valores em dólares como número puro.
- fixedFees: TODOS os fees fixos em dólar com o nome original (Underwriting Fee, Appraisal Fee,
  Legal Fee, Processing Fee, Feasibility Report Fee, Other Fees…). NÃO inclua os percentuais
  (origination/broker) nem o draw fee (têm campos próprios).
- Se os closing costs saem do bolso do borrower no fechamento ("cash from borrower",
  "DP + CC"), feesFinanced = false.
- Para o que não estiver no documento use 0 (números), "" (textos) ou UNKNOWN (enums).
  Não invente valores.`;

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

export async function analyzeLoiPdf(base64Pdf: string): Promise<LoiExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env to enable LOI analysis.");
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
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: base64Pdf },
            },
            { type: "text", text: PROMPT },
          ],
        },
      ],
      output_config: { format: zodOutputFormat(loiExtractionSchema) },
    }),
  );
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("A extração do LOI não retornou dados estruturados.");
  return parsed;
}
