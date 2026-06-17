import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Extração de uma declaração de PESSOA FÍSICA (US Form 1040 / IRS Tax Return Transcript).
// Texto ausente = "" (string vazia); só os números são nullable — para não estourar o
// limite de parâmetros union (anyOf) do structured output da API. SSN só os 4 últimos.
export const personalReturnSchema = z.object({
  taxpayerName: z.string(),
  spouseName: z.string(), // "" se não for declaração conjunta
  ssnLast4: z.string(), // apenas os 4 últimos dígitos
  spouseSsnLast4: z.string(),
  year: z.number().nullable(),
  filingStatus: z.string(), // ex.: "Married Filing Joint", "Single"
  form: z.string(), // ex.: "1040"
  preparer: z.string(), // PTIN/EIN do preparador, se houver
  wages: z.number().nullable(),
  ordinaryDividends: z.number().nullable(), // 1040 linha 3b
  qualifiedDividends: z.number().nullable(), // 1040 linha 3a
  businessIncomeC: z.number().nullable(), // Schedule C
  capitalGain: z.number().nullable(), // Schedule D
  rentalIncome: z.number().nullable(), // Schedule E — aluguel/royalties
  partnershipIncome: z.number().nullable(), // Schedule E — partnership/S-corp (renda)
  partnershipLoss: z.number().nullable(), // Schedule E — partnership/S-corp (perda, valor positivo)
  totalIncome: z.number().nullable(),
  agi: z.number().nullable(),
  taxableIncome: z.number().nullable(),
  totalTax: z.number().nullable(),
  seTax: z.number().nullable(),
  qbiDeduction: z.number().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string(),
});

export type PersonalReturnExtraction = z.infer<typeof personalReturnSchema>;

const PROMPT = `You are a US tax analyst. Read this individual income tax return — it may be a
Form 1040 or, most often, an "IRS Tax Return Transcript" (a structured text printout of the
filed 1040). Extract STRICTLY what the document shows:

1) taxpayerName and, on a joint return, spouseName (from "NAME(S) SHOWN ON RETURN").
2) ssnLast4 and spouseSsnLast4 — ONLY the last 4 digits (the document masks them as
   XXX-XX-1234; return "1234"). NEVER return a full SSN.
3) year (the Tax Period Ending year), filingStatus, form number ("1040"), and preparer
   (the PTIN / preparer EIN if shown).
4) The income lines, as numbers (null if blank, negative for losses):
   - wages ("WAGES, SALARIES, TIPS")
   - ordinaryDividends ("ORDINARY DIVIDEND INCOME" / 1040 line 3b) and qualifiedDividends
     (1040 line 3a) — these capture dividends received from C-corporations the person owns.
   - businessIncomeC ("BUSINESS INCOME OR LOSS (Schedule C)")
   - capitalGain ("CAPITAL GAIN OR LOSS (Schedule D)")
   - rentalIncome ("TOTAL RENTAL REAL ESTATE AND ROYALTY INCOME OR LOSS", Schedule E part I)
   - partnershipIncome and partnershipLoss — from Schedule E part II "INCOME OR LOSS FROM
     PARTNERSHIPS AND S CORPS". Use the "PARTNERSHIP INCOME" / "PARTNERSHIP LOSS" lines if
     present; otherwise sum the passive + nonpassive income into partnershipIncome and the
     passive + nonpassive losses into partnershipLoss (report the loss as a POSITIVE number).
     These two are the most important fields — they are cross-checked against the K-1s the
     person's LLCs issued, so read Schedule E carefully.
   - totalIncome ("TOTAL INCOME"), agi ("ADJUSTED GROSS INCOME"), taxableIncome
   - totalTax ("TOTAL TAX LIABILITY" / "TOTAL ASSESSMENT PER COMPUTER")
   - seTax ("SE TAX" — self-employment tax)
   - qbiDeduction ("QUALIFIED BUSINESS INCOME DEDUCTION")

Use null for any number not shown — never guess. For any TEXT field not shown, use "".
Set confidence to "low" if anything is unclear. Keep "summary" to ONE short sentence.`;

export async function analyzePersonalReturnPdf(
  base64Pdf: string,
): Promise<PersonalReturnExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env to enable analysis.");
  }
  const client = new Anthropic();
  const res = await client.messages.parse({
    model: "claude-opus-4-8",
    max_tokens: 4000,
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
    output_config: { format: zodOutputFormat(personalReturnSchema) },
  });

  const data = res.parsed_output;
  if (!data) throw new Error("Could not extract data from this document.");
  return data;
}
