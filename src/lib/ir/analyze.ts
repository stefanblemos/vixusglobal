import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Extração estruturada de um IR (declaração de imposto) — sócios + forma de tributação.
export const irOwnerSchema = z.object({
  name: z.string(),
  ownershipPct: z.number().nullable(),
  role: z.string().nullable(),
});

export const irExtractionSchema = z.object({
  companyName: z.string().nullable(),
  jurisdiction: z.enum(["US", "BR", "PT", "OTHER"]),
  year: z.number().nullable(),
  taxForm: z.string().nullable(),
  entityType: z.string().nullable(),
  taxTreatment: z.enum([
    "DISREGARDED",
    "PARTNERSHIP",
    "S_CORP",
    "C_CORP",
    "SOLE_PROP",
    "LUCRO_REAL",
    "LUCRO_PRESUMIDO",
    "SIMPLES_NACIONAL",
    "MEI",
    "REGIME_GERAL",
    "REGIME_SIMPLIFICADO",
    "OTHER",
  ]),
  owners: z.array(irOwnerSchema),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string(),
});

export type IrExtraction = z.infer<typeof irExtractionSchema>;

const PROMPT = `You are a tax analyst for a multinational holding (US, Brazil, Portugal).
Read this income tax return (IR) and extract, strictly from what the document shows:

1) The company it belongs to (legal name) and the tax year.
2) The tax form / return type (e.g. "Form 1120" = C-Corp, "Form 1120-S" = S-Corp,
   "Form 1065" = Partnership, "Schedule C" = sole proprietor/disregarded; Brazil
   "ECF"/DIRPJ with Lucro Real/Presumido or Simples Nacional/MEI; Portugal IRC
   Regime Geral/Simplificado).
3) From the form type, the tax treatment — map to one of the allowed enum values.
4) The legal entity type if stated.
5) The partners/shareholders (sócios): for each, name, ownership percentage if shown
   (e.g. from Schedule K-1, Schedule G, or a shareholders/quadro societário section),
   and their role. Use null for a percentage you cannot read — never guess a number.

Be faithful to the document. Set confidence to "low" if the document is unclear or a
field is inferred rather than stated. Put any caveats in the summary.`;

export async function analyzeTaxReturnPdf(base64Pdf: string): Promise<IrExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env to enable IR analysis.");
  }
  const client = new Anthropic();
  const res = await client.messages.parse({
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
    output_config: { format: zodOutputFormat(irExtractionSchema) },
  });

  const data = res.parsed_output;
  if (!data) throw new Error("Could not extract data from this document.");
  return data;
}
