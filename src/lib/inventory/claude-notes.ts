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
export type NotesAnalysis = { status: NotesStatus; summary: string; pending: string[]; covered: string[] };

export type NotesInvoice = { no: string; kind: "GOODS" | "FREIGHT" | "SAMPLE"; date: string; memo: string[]; costs: { label: string; amount: number }[] };

/** Hash do que foi analisado: se as invoices/memos mudarem, a nota fica "desatualizada". */
export function notesHash(invoices: NotesInvoice[]): string {
  const h = createHash("sha1");
  for (const i of [...invoices].sort((a, b) => a.no.localeCompare(b.no))) h.update(`${i.no}|${i.kind}|${i.memo.join("\n")}|${i.costs.map((c) => `${c.label}=${c.amount}`).join(";")}\n`);
  return h.digest("hex").slice(0, 16);
}

const PROMPT = (name: string, invoices: NotesInvoice[]) => `You are checking whether a container shipment from an import supplier has been FULLY billed.

Shipment: ${name}
Invoices in this shipment (chronological), with the free-text notes printed on each one and the cost lines already billed:

${invoices
  .map(
    (i) => `--- Invoice #${i.no} (${i.kind}, ${i.date})
Notes:
${i.memo.length ? i.memo.map((m) => "  " + m).join("\n") : "  (none)"}
Cost lines billed:
${i.costs.length ? i.costs.map((c) => `  ${c.label}: ${c.amount.toFixed(2)}`).join("\n") : "  (none — goods only)"}`,
  )
  .join("\n\n")}

Suppliers state in the notes which charges are NOT included on that invoice (e.g. "Freight, Shipping or Brokerage Fees NOT included", "Chassis, Yard Storage, CrossDocking NOT included"). A charge that one invoice says is NOT included may be billed later on another invoice of the same shipment. Your job: compare every "NOT included" statement against the cost lines billed on ALL invoices of the shipment.

Answer ONLY with JSON (no prose, no markdown fence):
{
  "status": "COMPLETE" | "PENDING" | "UNCLEAR",
  "summary": "<2-3 short sentences in Brazilian Portuguese for the operator: what has been billed, what is still expected, and whether the shipment looks ready to close costs>",
  "pending": ["<each charge still expected, short, in Portuguese>"],
  "covered": ["<each charge that a note said NOT included but was later billed, short, in Portuguese>"]
}
Rules: "COMPLETE" only when every charge named as NOT included has a matching billed line (or the notes say nothing is excluded). "PENDING" when at least one named charge has no billed line yet. "UNCLEAR" when notes are missing or contradictory. Downpayment / resale certificate / payment instructions are not charges. Keep it factual; do not invent charges that no note mentions.`;

export async function analyzeShipmentNotes(name: string, invoices: NotesInvoice[]): Promise<NotesAnalysis> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY não configurada.");
  const client = new Anthropic({ maxRetries: 3 });
  const res = await client.messages.create({ model: MODEL, max_tokens: 1200, messages: [{ role: "user", content: PROMPT(name, invoices) }] });
  const text = res.content.filter((c): c is Anthropic.TextBlock => c.type === "text").map((c) => c.text).join("\n");
  const a = text.indexOf("{");
  const b = text.lastIndexOf("}");
  if (a < 0 || b < a) throw new Error("Resposta sem JSON.");
  const raw = JSON.parse(text.slice(a, b + 1)) as Partial<NotesAnalysis>;
  const status: NotesStatus = raw.status === "COMPLETE" || raw.status === "PENDING" || raw.status === "UNCLEAR" ? raw.status : "UNCLEAR";
  const list = (v: unknown) => (Array.isArray(v) ? v.map((x) => String(x ?? "").trim()).filter(Boolean) : []);
  return { status, summary: String(raw.summary ?? "").trim() || "Sem resumo.", pending: list(raw.pending), covered: list(raw.covered) };
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
