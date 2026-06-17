import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Extração estruturada de um IR (declaração de imposto) — sócios + forma de tributação.
// Texto opcional usa "" (string vazia) em vez de null — para não estourar o limite
// de parâmetros com union (anyOf) do structured output da API. Numbers seguem nullable.
export const irOwnerSchema = z.object({
  name: z.string(),
  taxId: z.string(), // SSN/CPF/EIN do sócio ("" se não houver) — mascarado ao salvar
  ownershipPct: z.number().nullable(),
  allocatedIncome: z.number().nullable(), // renda alocada ao sócio (K-1, etc.)
  role: z.string(),
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
  "NON_DEDUCTIBLE",
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
  line: z.string(), // ex.: "1120 line 30", "F-1120" ("" se não houver)
});

// K-1 que a empresa declarante RECEBEU de investidas (pass-through). Campos
// obrigatórios (sem nullable) p/ não estourar o limite de union da API.
export const irK1ReceivedSchema = z.object({
  issuerName: z.string(), // empresa que emitiu o K-1 (a investida)
  issuerEin: z.string(), // EIN da emissora ("" se não houver)
  amount: z.number(), // valor líquido vindo dessa investida (pode ser negativo)
});

export const irExtractionSchema = z.object({
  companyName: z.string(),
  taxId: z.string(), // EIN/CNPJ/NIF da entidade ("" se não houver)
  jurisdiction: z.enum(["US", "BR", "PT", "OTHER"]),
  year: z.number().nullable(),
  taxForm: z.string(),
  isFinalReturn: z.boolean(), // "Final return" marcado (entidade encerrada no ano)
  entityType: z.string(),
  city: z.string(),
  state: z.string(),
  address: z.string(),
  businessActivity: z.string(),
  incorporationDate: z.string(),
  preparer: z.string(),
  responsible: z.string(), // Partnership Representative / responsável
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
  k1sReceived: z.array(irK1ReceivedSchema),
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
   Also set "isFinalReturn": true ONLY if the return's "Final return" box is checked
   (Form 1065 / 1120 / 1120-S item G "Final return"; Brazil "encerramento"/última ECF) —
   meaning the entity was dissolved/closed in this tax year. Otherwise false.
4) The legal entity type if stated; the city/state and full address; the business
   activity (and code); and the incorporation/organization date.
5) "figures": a list of EVERY monetary line on the return — gross receipts, cost of
   goods, other income, total income, ordinary business income, total deductions,
   depreciation, taxable income, net income (per books), total tax, estimated payments,
   amount owed/refund, state tax (e.g. Florida F-1120), etc. For each: key (one of the
   allowed codes, or OTHER), label (exactly as printed on the form), value (number, no
   symbols, null if blank), line (the form line reference, e.g. "1120 line 30", "F-1120").
   Map obvious ones to their code; use OTHER for the rest. Do NOT leave figures only in
   the summary — every number must be a figures item. ORDINARY_INCOME is ONLY the ordinary
   BUSINESS income (1065 line 22 / 1120 taxable income line) — NOT income from other
   partnerships (1065 line 4), net gains, or other income (1065 line 7); those are
   OTHER_INCOME. IMPORTANT: tag nondeductible
   expenses (Schedule K line 18c "Nondeductible expenses", or the Schedule M-1 add-backs
   for meals/entertainment, penalties, etc.) with key NON_DEDUCTIBLE — these reconcile
   book income to taxable income. Tag NET_INCOME with "Net income per books" (Schedule
   M-1 line 1).
6) Who prepared the return (preparer firm/person + PTIN) and the responsible/signing
   party (e.g. Partnership Representative, President, responsável legal).
7) The partners/shareholders (sócios): for each, name, their tax id (SSN/CPF/EIN) if
   shown, ownership percentage (e.g. from Schedule K-1, Schedule G, or the quadro
   societário), the income allocated to them (allocatedIncome), and their role. Use null
   for any number you cannot read — never guess.
8) "k1sReceived": EVERY Schedule K-1 the FILER RECEIVED from other partnerships/entities
   it INVESTED IN (the pass-through entities that reported income TO this filer — usually
   summarized on Form 1120 line 10 "Other income" with an attached statement, or 1065
   line 4 "Ordinary income from other partnerships" with a statement). For each: issuerName
   (the entity that issued the K-1), issuerEin, and amount (the net income reported from
   that entity — negative for a loss). IMPORTANT: look across ALL attached statements AND
   the Schedule K / Schedule K-1 detail and the actual K-1 copies — there are often MULTIPLE
   statements (Statement 1, 2, 3, 4…), each listing different investees; include EVERY
   pass-through entity from every statement, not just the first. Cross-check that the sum of
   your list ties to the return's reported pass-through income; if it doesn't, you missed
   one — re-scan. This is income RECEIVED as an investor — do NOT confuse with the filer's
   own shareholders/partners in (7). Only pass-through K-1 items; exclude plain investment
   income, rebates, trade-ins, etc. Empty list if none.

Be faithful to the document. Set confidence to "low" if anything is unclear or inferred.
For any TEXT field not shown on the document, use an empty string "" (not null). Use null
only for numeric values that are not shown. Keep "summary" to ONE short sentence of context
— the figures and fields carry the data, not the prose.`;

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
