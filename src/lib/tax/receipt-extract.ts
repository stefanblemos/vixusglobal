import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Extração estruturada de um recibo/notice de imposto estadual de renda (ex.: Florida
// Department of Revenue — F-1120). Separa principal, multa e juros e identifica o ANO DE
// COMPETÊNCIA (o ano a que a declaração se refere, ex.: F-1120 de 2024), que NÃO é o ano do
// pagamento. Alimenta o formulário do controle estadual.
export const stateTaxReceiptSchema = z.object({
  companyName: z.string(), // contribuinte no documento ("" se não houver)
  jurisdiction: z.string(), // sigla do estado, ex.: "FL"
  taxYear: z.number().nullable(), // ANO DE COMPETÊNCIA da declaração (ex.: 2024), não o do pagamento
  principal: z.number().nullable(), // imposto (tax/principal)
  penalty: z.number().nullable(), // multa
  interest: z.number().nullable(), // juros
  total: z.number().nullable(), // total pago/devido
  paidDate: z.string(), // data do pagamento (ISO YYYY-MM-DD) — "" se não houver
  source: z.string(), // origem, ex.: "F-1120 notice"
  confidence: z.enum(["low", "medium", "high"]),
});

export type StateTaxReceipt = z.infer<typeof stateTaxReceiptSchema>;

const PROMPT = `You are a tax analyst. This document is a US STATE corporate income/franchise tax
notice, bill, or payment receipt (e.g. Florida Department of Revenue, Form F-1120). Extract,
strictly from what the document shows:

- companyName: the taxpayer/corporation name ("" if not shown).
- jurisdiction: the state's two-letter code (e.g. "FL").
- taxYear: the TAX YEAR the return is FOR — the period of competence (e.g. an "F-1120 - 2024"
  or "taxable year end 12/31/2024" means taxYear = 2024). This is NOT the date the payment was
  made (a 2024 return is often paid in 2025). If only a "for tax year XXXX" or "FYXXXX" is shown,
  use that. null only if truly absent.
- principal: the TAX / principal amount (labeled "Tax", "Income tax", "Total corporate
  income/franchise tax due", the tax before penalty and interest). Number only, no symbols.
- penalty: the PENALTY amount ("Penalty"). 0 if none shown.
- interest: the INTEREST amount ("Interest"). 0 if none shown.
- total: the total amount due/paid ("Total Due", "Amount due", "Total"). It should equal
  principal + penalty + interest.
- paidDate: the payment/remittance date in ISO YYYY-MM-DD if shown ("" otherwise).
- source: a short label for the document, e.g. "F-1120 notice" or "FL DOR payment".

Be faithful. Set confidence to "low" if penalty/interest split is unclear. Use null only for
numbers genuinely not shown; never guess.`;

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

export async function extractStateTaxReceipt(base64Pdf: string): Promise<StateTaxReceipt> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env to enable receipt reading.");
  }
  const client = new Anthropic({ maxRetries: 4 });
  let res;
  try {
    res = await withRetry(() =>
      client.messages.parse({
        model: "claude-opus-4-8",
        max_tokens: 4000,
        thinking: { type: "adaptive" },
        messages: [
          {
            role: "user",
            content: [
              { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64Pdf } },
              { type: "text", text: PROMPT },
            ],
          },
        ],
        output_config: { format: zodOutputFormat(stateTaxReceiptSchema) },
      }),
    );
  } catch (e: unknown) {
    const status = (e as { status?: number })?.status;
    const type = (e as { error?: { error?: { type?: string } } })?.error?.error?.type;
    if ((typeof status === "number" && status >= 500) || type === "overloaded_error") {
      throw new Error(
        "AI service temporarily unavailable (Anthropic API overloaded). This is on Anthropic's side, not your file — please try again in a few minutes.",
      );
    }
    throw e;
  }

  const data = res.parsed_output;
  if (!data) throw new Error("Could not extract data from this receipt.");
  return data;
}
