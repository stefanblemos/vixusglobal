import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Extração estruturada de um IR (declaração de imposto) — sócios + forma de tributação.
export const irOwnerSchema = z.object({
  name: z.string(),
  taxId: z.string().nullable(), // SSN/CPF/EIN do sócio — será mascarado ao salvar
  ownershipPct: z.number().nullable(),
  allocatedIncome: z.number().nullable(), // renda alocada ao sócio (K-1, etc.)
  role: z.string().nullable(),
});

// Chaves normalizadas para os números do IR (permitem comparar IR × QBO).
export const FIGURE_KEYS = [
  "GROSS_RECEIPTS",
  "COST_OF_GOODS",
  "OTHER_INCOME",
  "TOTAL_INCOME",
  "ORDINARY_INCOME",
  "TOTAL_DEDUCTIONS",
  "DEPRECIATION",
  "TAXABLE_INCOME",
  "NET_INCOME",
  "TOTAL_TAX",
  "ESTIMATED_PAYMENTS",
  "TAX_DUE",
  "TAX_REFUND",
  "STATE_TAX",
  "OTHER",
] as const;

export const irFigureSchema = z.object({
  key: z.enum(FIGURE_KEYS),
  label: z.string(), // rótulo como aparece no formulário
  value: z.number().nullable(),
  line: z.string().nullable(), // ex.: "1120 line 30", "F-1120"
});

export const irExtractionSchema = z.object({
  companyName: z.string().nullable(),
  taxId: z.string().nullable(), // EIN/CNPJ/NIF da entidade
  jurisdiction: z.enum(["US", "BR", "PT", "OTHER"]),
  year: z.number().nullable(),
  taxForm: z.string().nullable(),
  entityType: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  address: z.string().nullable(),
  businessActivity: z.string().nullable(),
  incorporationDate: z.string().nullable(),
  preparer: z.string().nullable(),
  responsible: z.string().nullable(), // Partnership Representative / responsável
  figures: z.array(irFigureSchema),
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

1) The company it belongs to (legal name), its tax id (EIN / CNPJ / NIF), and the tax year.
2) The tax form / return type (e.g. "Form 1120" = C-Corp, "Form 1120-S" = S-Corp,
   "Form 1065" = Partnership, "Schedule C" = sole proprietor/disregarded; Brazil
   "ECF"/DIRPJ with Lucro Real/Presumido or Simples Nacional/MEI; Portugal IRC
   Regime Geral/Simplificado).
3) From the form type, the tax treatment — map to one of the allowed enum values.
4) The legal entity type if stated; the city/state and full address; the business
   activity (and code); and the incorporation/organization date.
5) "figures": a list of EVERY monetary line on the return — gross receipts, cost of
   goods, other income, total income, ordinary business income, total deductions,
   depreciation, taxable income, net income (per books), total tax, estimated payments,
   amount owed/refund, state tax (e.g. Florida F-1120), etc. For each: key (one of the
   allowed codes, or OTHER), label (exactly as printed on the form), value (number, no
   symbols, null if blank), line (the form line reference, e.g. "1120 line 30", "F-1120").
   Map obvious ones to their code; use OTHER for the rest. Do NOT leave figures only in
   the summary — every number must be a figures item.
6) Who prepared the return (preparer firm/person + PTIN) and the responsible/signing
   party (e.g. Partnership Representative, President, responsável legal).
7) The partners/shareholders (sócios): for each, name, their tax id (SSN/CPF/EIN) if
   shown, ownership percentage (e.g. from Schedule K-1, Schedule G, or the quadro
   societário), the income allocated to them (allocatedIncome), and their role. Use null
   for any number you cannot read — never guess.

Be faithful to the document. Set confidence to "low" if anything is unclear or inferred.
Keep "summary" to ONE short sentence of context — the figures and fields carry the data,
not the prose.`;

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
