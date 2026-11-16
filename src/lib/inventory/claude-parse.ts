/**
 * Inventory — leitura de invoice pelo Claude (fallback do leitor pdf.js).
 * Quando o PDF não tem camada de texto utilizável (escaneado, ou "impresso" pelo Distiller com
 * fontes sem mapa de caracteres — caso real de 17/11/2026), o pdf.js devolve símbolos e o leitor
 * por posição não reconhece nada. Aqui o PDF inteiro vai para a Messages API como documento
 * (a API renderiza as páginas e lê por visão) e volta no MESMO formato ParsedInvoice.
 */

import Anthropic from "@anthropic-ai/sdk";
import { buildPdfSource, cleanupPdfSource, pdfRequestOptions } from "@/lib/anthropic/pdf-source";
import type { ParsedInvoice, ParsedLine } from "./parse-invoice";

const MODEL = "claude-sonnet-5-5";

const PROMPT = `You are reading a PDF that may contain one or more supplier invoices (QuickBooks-style, e.g. from "Archway Trade LLC") plus attachments such as bank transfer confirmations, receipts or statements.

Return ONLY a JSON array (no prose, no markdown fence). One object per INVOICE found. Skip every page that is not an invoice (bank transfers, "Transfer Submitted", payment receipts, statements). An invoice may span two pages (lines on page 1, totals/notes on page 2): merge them into one object.

Object shape (use null when the document does not show a value):
{
  "no": "26048",                       // INVOICE # as printed, digits only
  "date": "03/09/2026",                // DATE as printed, MM/DD/YYYY
  "terms": "Due on receipt",
  "lines": [                           // every row of the ACTIVITY / QTY / RATE / AMOUNT table, in order
    { "activity": "Shipping and Handling:Shipping and Handling new",   // first line of the ACTIVITY cell, exactly as printed
      "desc": ["Ocean Freight 20'"],   // remaining lines of the ACTIVITY cell, one string per line
      "qty": 2, "rate": 2720.00, "amount": 5440.00 }
  ],
  "memo": ["Container: SPRU3119111 / SPRU3119301", "Vinyl Floor Order", "Invoice 26002", "* Yard Storage, CrossDocking NOT included"],
                                       // every free-text note/footnote line outside the table and outside PAYMENT DETAILS,
                                       // one string per line, exactly as printed (keep "Container:", "Invoice NNNNN", "*" notes)
  "container": "SPRU3119111 / SPRU3119301",   // text after "Container:" if present, else null
  "subtotal": 18217.64,
  "discount": 0,                       // negative if a discount line reduces the total, else 0
  "tax": 0,
  "total": 18217.64,                   // the TOTAL line (never BALANCE DUE)
  "payment": null,                     // PAYMENT / amount received line if printed, else null
  "balance": 18217.64,                 // BALANCE DUE if printed, else null
  "pages": 2                           // number of pages this invoice occupies
}

Rules: product rows have activity starting with "Products:"; keep numbers as numbers (no currency symbols, no thousands separators); qty/rate null when the cell is blank; do not invent rows; do not include PAYMENT DETAILS (bank account) lines anywhere.`;

type Raw = Partial<ParsedInvoice> & { lines?: Partial<ParsedLine>[] };

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const strOrNull = (v: unknown) => (v == null ? null : String(v).trim() || null);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : typeof v === "string" && v.trim() ? v.split("\n").map((x) => x.trim()).filter(Boolean) : []);

function normalize(raw: Raw): ParsedInvoice | null {
  const no = strOrNull(raw.no)?.replace(/\D/g, "") || null;
  const lines: ParsedLine[] = (raw.lines ?? [])
    .map((l) => ({ activity: String(l.activity ?? "").trim(), desc: strList(l.desc), qty: num(l.qty), rate: num(l.rate), amount: num(l.amount) ?? 0 }))
    .filter((l) => l.activity || l.amount);
  if (!no && !lines.length) return null;
  const memo = strList(raw.memo);
  const container = strOrNull(raw.container) ?? memo.find((m) => /^container\s*:/i.test(m))?.replace(/^container\s*:\s*/i, "") ?? null;
  if (container && !memo.some((m) => /^container\s*:/i.test(m))) memo.unshift(`Container: ${container}`);
  return {
    no,
    date: strOrNull(raw.date),
    terms: strOrNull(raw.terms),
    lines,
    memo,
    container,
    subtotal: num(raw.subtotal),
    discount: num(raw.discount) ?? 0,
    tax: num(raw.tax) ?? 0,
    total: num(raw.total) ?? num(raw.subtotal),
    payment: num(raw.payment),
    balance: num(raw.balance),
    pages: num(raw.pages) ?? 1,
  };
}

/** Lê as invoices do PDF pelo Claude. Lança erro com mensagem legível se a API falhar. */
export async function parseInvoicePdfWithClaude(buf: Buffer): Promise<ParsedInvoice[]> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY não configurada.");
  const client = new Anthropic({ maxRetries: 3 });
  const pdf = await buildPdfSource(client, buf);
  try {
    const res = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 8000,
        messages: [{ role: "user", content: [{ type: "document", source: pdf.source as unknown as Anthropic.Base64PDFSource }, { type: "text", text: PROMPT }] }],
      },
      pdfRequestOptions(pdf),
    );
    const text = res.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("\n");
    const start = text.indexOf("[");
    const end = text.lastIndexOf("]");
    if (start < 0 || end < start) throw new Error("Resposta sem JSON.");
    const arr = JSON.parse(text.slice(start, end + 1)) as Raw[];
    return arr.map(normalize).filter((x): x is ParsedInvoice => !!x);
  } finally {
    await cleanupPdfSource(client, pdf);
  }
}
