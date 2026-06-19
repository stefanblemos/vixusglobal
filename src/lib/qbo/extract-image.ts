import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Extração estruturada de um P&L ou Balance Sheet a partir de IMAGEM/PDF (quando o QBO
// não gera mais — empresa encerrada). Produz linhas no mesmo formato do parser de CSV,
// para virar um QboImport normal.

const lineSchema = z.object({
  label: z.string(), // rótulo da linha exatamente como aparece
  section: z.string(), // seção-pai ("" se for topo)
  lineType: z.enum(["SECTION", "ACCOUNT", "TOTAL"]),
  value: z.number().nullable(), // valor (negativo p/ negativos/parênteses; null se vazio)
});

export const reportImageSchema = z.object({
  reportType: z.enum(["PROFIT_AND_LOSS", "BALANCE_SHEET", "UNKNOWN"]),
  companyName: z.string(),
  periodLabel: z.string(), // ex.: "January - December, 2024" / "As of December 31, 2024"
  basis: z.string(), // "Accrual" | "Cash" | ""
  currency: z.string(), // ISO (USD/BRL/EUR); "USD" se não indicado
  lines: z.array(lineSchema),
  confidence: z.enum(["low", "medium", "high"]),
});

export type ReportImageExtraction = z.infer<typeof reportImageSchema>;

const PROMPT = `You read a QuickBooks-style financial statement from an image or PDF and extract it faithfully.

1) reportType: "PROFIT_AND_LOSS" if it's an income statement (Income/Revenue, COGS, Expenses, Net Income), "BALANCE_SHEET" if it shows Assets/Liabilities/Equity as of a date, else "UNKNOWN".
2) companyName (legal name at the top), periodLabel (P&L: the date range exactly, e.g. "January - December, 2024"; BS: "As of December 31, 2024"), basis ("Accrual"/"Cash"/""), currency (ISO; "USD" if the symbols are $ and nothing else indicated; "BRL" for R$, "EUR" for €).
3) lines: EVERY row in order. For each: label (exactly as printed), section (the parent section name it sits under, "" for top level), lineType (SECTION for a heading with no own number, ACCOUNT for an account with a value, TOTAL for total/subtotal/net lines), value (number only — no currency symbols or commas; negative for negatives or numbers in parentheses; null if blank).

CRITICAL for a P&L — the section TOTAL lines must use these EXACT labels when present, so totals reconcile downstream: "Total Income", "Total Cost of Goods Sold", "Total Expenses", "Total Other Income", "Total Other Expenses". Also include the bottom line as a TOTAL labeled "Net Income" (and "Net Operating Income" if shown). Keep every account line too.

Be faithful to the document — never invent numbers. Set confidence "low" if anything is blurry or inferred. Use "" for any text not shown and null only for blank numbers.`;

function imageBlock(base64: string, mediaType: string) {
  if (mediaType === "application/pdf") {
    return { type: "document" as const, source: { type: "base64" as const, media_type: "application/pdf" as const, data: base64 } };
  }
  const mt = (["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mediaType)
    ? mediaType
    : "image/jpeg") as "image/png" | "image/jpeg" | "image/gif" | "image/webp";
  return { type: "image" as const, source: { type: "base64" as const, media_type: mt, data: base64 } };
}

export async function extractReportFromImage(
  base64: string,
  mediaType: string,
): Promise<ReportImageExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env to enable image extraction.");
  }
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    messages: [
      {
        role: "user",
        content: [imageBlock(base64, mediaType), { type: "text", text: PROMPT }],
      },
    ],
    output_config: { format: zodOutputFormat(reportImageSchema) },
  });
  const parsed = res.parsed_output;
  if (!parsed) throw new Error("Could not extract the statement from this image.");
  return parsed;
}
