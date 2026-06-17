import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";

// Extração de documentos societários/constitutivos (Articles, Operating Agreement,
// Sunbiz Annual Report, etc.). Texto opcional usa "" (não null) p/ não estourar o
// limite de union (anyOf) da API; só números seguem nullable.
export const CORP_DOC_TYPES = [
  "ARTICLES",
  "OPERATING_AGREEMENT",
  "ANNUAL_REPORT",
  "CERTIFICATE",
  "EIN_LETTER",
  "OTHER",
] as const;

export const corpPersonSchema = z.object({
  name: z.string(),
  title: z.string(), // ex.: "Manager", "Member", "MGR", "President", "Authorized Person"
  address: z.string(),
});

export const corporateDocSchema = z.object({
  companyName: z.string(),
  taxId: z.string(), // FEI/EIN ("" se não houver)
  jurisdiction: z.enum(["US", "BR", "PT", "OTHER"]),
  state: z.string(), // ex.: "FL"
  docType: z.enum(CORP_DOC_TYPES),
  docNumber: z.string(), // nº de registro estadual (Sunbiz "Document Number")
  year: z.number().nullable(), // ano do annual report / período de referência
  formationDate: z.string(),
  filingDate: z.string(),
  status: z.string(), // ex.: "ACTIVE"
  registeredAgentName: z.string(),
  registeredAgentAddress: z.string(),
  principalAddress: z.string(),
  mailingAddress: z.string(),
  people: z.array(corpPersonSchema), // administradores/membros/diretores/oficiais
  confidence: z.enum(["low", "medium", "high"]),
  summary: z.string(),
});

export type CorporateDocExtraction = z.infer<typeof corporateDocSchema>;

const PROMPT = `You are a corporate paralegal. Read this corporate/constitutional document for a
company (could be a US state filing like Florida Sunbiz Articles of Organization/Incorporation,
an LLC Operating Agreement, a state Annual Report, a Certificate of Status, an EIN/FEI letter,
or a Brazilian/Portuguese equivalent). Extract, strictly from what the document shows:

1) docType — classify: ARTICLES (Articles of Organization/Incorporation, constituição),
   OPERATING_AGREEMENT (LLC operating agreement / contrato social / acordo de sócios),
   ANNUAL_REPORT (state annual report, e.g. Florida Sunbiz annual report), CERTIFICATE
   (certificate of status/good standing), EIN_LETTER (IRS EIN/FEI assignment letter), or OTHER.
2) The company legal name; its tax id (FEI/EIN / CNPJ / NIF); the state and jurisdiction.
3) docNumber — the state registration/document number (e.g. Florida "Document Number" Lxxxxxxxx).
4) year — for an Annual Report, the report year; otherwise the document's reference year if any
   (null if none).
5) formationDate (date organized/incorporated), filingDate (when this document was filed), and
   status (e.g. ACTIVE) if shown.
6) The registered agent: name and full address.
7) principalAddress (principal place of business) and mailingAddress.
8) "people": EVERY authorized person on the document — managers, members, managing members,
   officers, directors (for a corp), authorized representatives (for an LLC/Sunbiz report),
   or sócios/administradores (BR/PT). For each: name, title/role (exactly as printed, e.g.
   "MGR", "Manager", "President", "Member", "Authorized Person"), and address. These are the
   people the STATE has on record — they should match the partners/officers on the tax return.

Be faithful to the document. Set confidence to "low" if anything is unclear. For any TEXT field
not shown, use an empty string "" (not null). Use null only for the numeric year if absent. Keep
"summary" to ONE short sentence.`;

export async function analyzeCorporateDocPdf(base64Pdf: string): Promise<CorporateDocExtraction> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY is not set. Add it to .env to enable document analysis.");
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
    output_config: { format: zodOutputFormat(corporateDocSchema) },
  });
  const data = res.parsed_output;
  if (!data) throw new Error("Could not extract data from this document.");
  return data;
}
