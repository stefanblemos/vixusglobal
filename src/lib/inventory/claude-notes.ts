/**
 * Inventory — leitura dos MEMOS do embarque pelo Claude (17/11/2026, pedido do Stefan).
 * Cada invoice da Archway diz nas notas o que está ou não incluído ("Freight, Shipping or
 * Brokerage Fees NOT included", "Chassis, Yard Storage, CrossDocking NOT included"). Cada
 * fornecedor escreve de um jeito, então em vez de regra fixa o agente lê as notas de TODAS as
 * invoices do embarque e deixa uma nota clara: o que já foi cobrado e o que ainda deve vir.
 * Entrada só de texto (memos + linhas de custo); saída JSON curta. Módulo de servidor.
 */

import { createHash } from "crypto";
import Anthropic from "@anthropic-ai/sdk";
import { costLabel } from "./classify";
import type { InvoiceRow } from "./shipments";

const MODEL = "claude-sonnet-5-5";

export type NotesStatus = "COMPLETE" | "PENDING" | "UNCLEAR";
export type NotesAnalysis = { status: NotesStatus; summary: string; pending: string[]; covered: string[]; contingent: string[] };

export type NotesInvoice = { no: string; kind: "GOODS" | "FREIGHT" | "SAMPLE"; date: string; memo: string[]; costs: { label: string; amount: number }[] };

/** Hash do que foi analisado: se as invoices/memos mudarem, a nota fica "desatualizada". */
export function notesHash(invoices: NotesInvoice[]): string {
  const h = createHash("sha1");
  for (const i of [...invoices].sort((a, b) => a.no.localeCompare(b.no))) h.update(`${i.no}|${i.kind}|${i.memo.join("\n")}|${i.costs.map((c) => `${c.label}=${c.amount}`).join(";")}\n`);
  return h.digest("hex").slice(0, 16);
}

const PROMPT = (name: string, invoices: NotesInvoice[], closeTerms: string[]) => `You are checking whether a container shipment from an import supplier has been FULLY billed, so the operator can "close costs" (freeze the landed cost of the goods).

Shipment: ${name}
Invoices in this shipment in ORDER OF ISSUE (oldest first), each with the free-text notes printed on it and the cost lines actually billed:

${invoices
  .map(
    (i) => `--- Invoice #${i.no} (${i.kind}, ${i.date})
Notes:
${i.memo.length ? i.memo.map((m) => "  " + m).join("\n") : "  (none)"}
Cost lines billed:
${i.costs.length ? i.costs.map((c) => `  ${c.label}: ${c.amount.toFixed(2)}`).join("\n") : "  (none — goods only)"}`,
  )
  .join("\n\n")}

How to read this (rules from the operator):
1. Read chronologically. An older invoice says which charges are NOT included ON THAT INVOICE; newer invoices then bill those charges. A charge named as "NOT included" on an older invoice is SETTLED as soon as any later invoice has a billed line for it. Notes on an older invoice never override lines billed later.
2. The shipment reaches its end when the final-leg services are BILLED AS LINES: ${closeTerms.length ? closeTerms.join(", ") : "cross-docking, unloading, delivery"} (also "flatbed/delivery fee", "final delivery"). If such lines exist, the shipment is COMPLETE. Words in notes do not count; only billed lines count.
3. Charges that only happen if something goes wrong — yard storage, demurrage, detention, per-diem, storage, waiting time — are CONTINGENT. They never block closing: list them under "contingent", not "pending", even if a note says NOT included.
4. "PENDING" only when a real, expected charge (freight, drayage, customs clearance, duties, insurance, handling, cross-docking/unloading/delivery) was named as NOT included and no later invoice billed it AND the final-leg lines of rule 2 are not billed yet. "UNCLEAR" only when there are no notes at all and no freight invoice.
5. Downpayment, resale certificate, payment instructions are not charges.

Answer ONLY with JSON (no prose, no markdown fence):
{
  "status": "COMPLETE" | "PENDING" | "UNCLEAR",
  "summary": "<2-3 short sentences in Brazilian Portuguese: what was billed and on which invoices, what (if anything) is still expected, and whether it is safe to close costs now>",
  "pending": ["<real charges still expected, in Portuguese; empty when COMPLETE>"],
  "contingent": ["<contingent charges mentioned as NOT included that may or may not ever be billed, in Portuguese>"],
  "covered": ["<charges an older note said NOT included that a later invoice billed, in Portuguese>"]
}`;

export async function analyzeShipmentNotes(name: string, invoices: NotesInvoice[], closeTerms: string[] = []): Promise<NotesAnalysis> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY não configurada.");
  const client = new Anthropic({ maxRetries: 3 });
  const res = await client.messages.create({ model: MODEL, max_tokens: 1200, messages: [{ role: "user", content: PROMPT(name, invoices, closeTerms) }] });
  const text = res.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("\n");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Resposta sem JSON.");
  const raw = JSON.parse(text.slice(a, b + 1)) as Partial<NotesAnalysis>;
  const status: NotesStatus = raw.status === "COMPLETE" || raw.status === "PENDING" || raw.status === "UNCLEAR" ? raw.status : "UNCLEAR";
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
  return { status, summary: String(raw.summary ?? "").trim() || "Sem resumo.", pending: list(raw.pending), covered: list(raw.covered), contingent: list(raw.contingent) };
}

/** Invoices do embarque (mercadoria + frete + frete tardio) no formato da análise. */
export function toNotesInvoices(rows: InvoiceRow[]): NotesInvoice[] {
  return rows
    .filter((i) => i.kind !== "SAMPLE")
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .map((i) => ({
      no: i.no,
      kind: i.kind,
      date: i.date.toISOString().slice(0, 10),
      memo: i.memo,
      costs: i.lines.filter((l) => !l.isProduct).map((l) => ({ label: costLabel(l.activity, l.desc), amount: l.amount })),
    }));
}
