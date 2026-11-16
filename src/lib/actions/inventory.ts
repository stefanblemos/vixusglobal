"use server";

/**
 * Inventory (16/11/2026) — ações do módulo de importação (Archway → BuildPro).
 * Regras na memória vixus-inventory-import-module. Tudo é por empresa (companyId).
 */

import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";
import { classifyCost, isProductActivity, productName, containersOf, refsOf } from "@/lib/inventory/classify";
import { linesClose, usDateToIso, type ParsedInvoice } from "@/lib/inventory/parse-invoice";
import { buildShipmentView, loadInvoices, recomputeShipments, toClosedData } from "@/lib/inventory/shipments";
import { loadGlData, glItemName } from "@/lib/inventory/gl";
import { runFifo } from "@/lib/inventory/fifo";
import { getInventorySettings, isClosedBooks, pickVendor, priceForMargin, vendorOfRawName } from "@/lib/inventory/settings";

const INV = "/inventory";
const num = (v: FormDataEntryValue | null | undefined) => {
  const x = Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(x) ? x : 0;
};
const str = (v: FormDataEntryValue | null | undefined) => String(v ?? "").trim();
const isoDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T12:00:00Z`) : null);
const r2 = (v: number) => Math.round(v * 100) / 100;
const who = async () => (await auth())?.user?.email ?? "sistema";
const isAdmin = async () => (await auth())?.user?.role === "ADMIN";
const touch = () => revalidatePath(INV, "layout");

export type InvState = { error?: string; ok?: string } | undefined;

// ─── settings ────────────────────────────────────────────────────────────────
export async function saveInventorySettings(_p: InvState, fd: FormData): Promise<InvState> {
  const companyId = str(fd.get("companyId"));
  if (!companyId) return { error: "Empresa?" };
  const marginPct = num(fd.get("marginPct"));
  if (marginPct < 0 || marginPct >= 100) return { error: "Margem entre 0 e 99% (sobre o preço)." };
  await getInventorySettings(companyId);
  await prisma.inventorySettings.update({
    where: { companyId },
    data: {
      marginPct,
      booksClosedThrough: /^\d{4}-\d{2}$/.test(str(fd.get("booksClosedThrough"))) ? str(fd.get("booksClosedThrough")) : null,
      glInventoryAccount: str(fd.get("glInventoryAccount")) || "Inventory Asset",
      glFreightAccount: str(fd.get("glFreightAccount")) || "Inventory Asset - Freight & Handling",
      glCogsMaterialAccount: str(fd.get("glCogsMaterialAccount")) || "Supplies & materials - COGS",
      glCogsFreightAccount: str(fd.get("glCogsFreightAccount")) || "Shipping and Handling",
    },
  });
  touch();
  return { ok: "Configuração salva." };
}

// ─── fornecedores ────────────────────────────────────────────────────────────
export async function saveVendor(_p: InvState, fd: FormData): Promise<InvState> {
  const companyId = str(fd.get("companyId"));
  const id = str(fd.get("id"));
  const name = str(fd.get("name"));
  if (!companyId || !name) return { error: "Nome do fornecedor?" };
  const data = {
    name,
    aliases: str(fd.get("aliases")).split(",").map((x) => x.trim()).filter(Boolean),
    closeHintTerms: str(fd.get("closeHintTerms")).split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
    waitDays: Math.max(0, Math.round(num(fd.get("waitDays")))) || 30,
    active: str(fd.get("active")) !== "0",
    notes: str(fd.get("notes")) || null,
  };
  const dup = await prisma.inventoryVendor.findFirst({ where: { companyId, name, ...(id ? { id: { not: id } } : {}) } });
  if (dup) return { error: `Já existe o fornecedor "${name}".` };
  if (id) {
    const cur = await prisma.inventoryVendor.findUnique({ where: { id } });
    if (!cur || cur.companyId !== companyId) return { error: "Fornecedor?" };
    await prisma.inventoryVendor.update({ where: { id }, data });
    if (cur.name !== name) await prisma.inventoryInvoice.updateMany({ where: { companyId, vendorName: cur.name }, data: { vendorName: name } });
  } else await prisma.inventoryVendor.create({ data: { companyId, ...data } });
  touch();
  return { ok: id ? "Fornecedor atualizado." : "Fornecedor incluído." };
}

export async function deleteVendor(_p: InvState, fd: FormData): Promise<InvState> {
  const id = str(fd.get("id"));
  const v = await prisma.inventoryVendor.findUnique({ where: { id } });
  if (!v) return { error: "Fornecedor?" };
  const used = await prisma.inventoryInvoice.count({ where: { companyId: v.companyId, vendorName: v.name } });
  if (used) return { error: `${used} invoice(s) deste fornecedor. Desative em vez de excluir.` };
  await prisma.inventoryVendor.delete({ where: { id } });
  touch();
  return { ok: "Fornecedor excluído." };
}

// ─── items ───────────────────────────────────────────────────────────────────

/** Cria itens a partir dos nomes do GL (abertura + vendas) que ainda não existem. Nome do GL = item do QBO. */
export async function seedItemsFromGl(fd: FormData): Promise<void> {
  const companyId = str(fd.get("companyId"));
  if (!companyId) return;
  const s = await getInventorySettings(companyId);
  const gl = await loadGlData(companyId, s);
  const existing = await prisma.inventoryItem.findMany({ where: { companyId }, select: { id: true, name: true, glNames: true } });
  const known = new Map(existing.flatMap((e) => [e.name, ...e.glNames].map((n) => [n, e.id] as const)));
  for (const name of [...Object.keys(gl.cogsByName), ...Object.keys(gl.revenueByName)].filter(Boolean)) {
    if (known.has(name)) continue;
    const it = await prisma.inventoryItem.create({ data: { companyId, name, glNames: [name] } });
    known.set(name, it.id);
  }
  for (const [raw, v] of Object.entries(gl.openingByName)) {
    if (known.has(raw)) continue;
    const ownerId = known.get(v.cleanName);
    if (ownerId) {
      const it = await prisma.inventoryItem.findUnique({ where: { id: ownerId } });
      if (it) await prisma.inventoryItem.update({ where: { id: ownerId }, data: { glNames: [...new Set([...it.glNames, raw])], category: it.category ?? v.category } });
    } else {
      const it = await prisma.inventoryItem.create({ data: { companyId, name: v.cleanName, category: v.category, glNames: [...new Set([v.cleanName, raw])] } });
      known.set(raw, it.id);
      known.set(v.cleanName, it.id);
    }
  }
  touch();
}

/** Carga inicial: CSV de "Products and Services" do QBO (nome, preço, custo, qty). Cabeçalhos flexíveis. */
export async function importItemsCsv(_p: InvState, fd: FormData): Promise<InvState> {
  const companyId = str(fd.get("companyId"));
  const file = fd.get("file");
  if (!companyId || !(file instanceof File) || file.size === 0) return { error: "Escolha o CSV exportado do QBO." };
  const text = Buffer.from(await file.arrayBuffer()).toString("utf8").replace(/^﻿/, "");
  const parsed = Papa.parse<Record<string, string>>(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data ?? [];
  if (!rows.length) return { error: "CSV vazio ou sem cabeçalho." };
  const headers = Object.keys(rows[0]);
  const find = (re: RegExp) => headers.find((h) => re.test(h));
  const hName = find(/full\s*name|product\/service\s*name|^name$|item/i) ?? find(/name/i);
  const hPrice = find(/sales\s*price|price|rate/i);
  const hCost = find(/purchase\s*cost|^cost$|cost/i);
  const hQty = find(/quantity|qty|on\s*hand/i);
  const hType = find(/^type$/i);
  if (!hName) return { error: `Não achei a coluna do nome. Cabeçalhos: ${headers.join(", ")}` };
  const today = new Date();
  let created = 0;
  let updated = 0;
  for (const r of rows) {
    const full = (r[hName] ?? "").trim();
    if (!full) continue;
    if (hType && r[hType] && !/inventory/i.test(r[hType])) continue; // só itens de estoque
    const parts = full.split(":").map((x) => x.trim()).filter(Boolean);
    const name = parts[parts.length - 1];
    const category = parts.length > 1 ? parts.slice(0, -1).join(" › ") : null;
    const price = hPrice ? num(r[hPrice]) : 0;
    const cost = hCost ? num(r[hCost]) : 0;
    const qty = hQty ? num(r[hQty]) : null;
    // item já criado a partir do GL com o nome "comprido" (descrição da venda colada): vira este item
    let ex = await prisma.inventoryItem.findUnique({ where: { companyId_name: { companyId, name } } });
    if (!ex) {
      const long = await prisma.inventoryItem.findFirst({ where: { companyId, OR: [{ name: { startsWith: `${name} /` } }, { name: { startsWith: `${name} ` } }, { glNames: { has: name } }] } });
      if (long) ex = await prisma.inventoryItem.update({ where: { id: long.id }, data: { name, glNames: [...new Set([...long.glNames, long.name, name])] } });
    }
    const data = {
      category: category ?? ex?.category ?? null,
      ...(price > 0 ? { listPrice: price, listPriceAt: today } : {}),
      ...(qty != null ? { qtyOnHand: qty, qtyAt: today } : {}),
      ...(cost > 0 && !ex?.currentCost ? { currentCost: cost, currentCostAt: today } : {}),
    };
    const item = ex ? await prisma.inventoryItem.update({ where: { id: ex.id }, data }) : await prisma.inventoryItem.create({ data: { companyId, name, glNames: [name], ...data } });
    if (price > 0) await prisma.inventoryItemPrice.create({ data: { itemId: item.id, price, effectiveFrom: today, source: "CSV", note: file.name } });
    ex ? updated++ : created++;
  }
  touch();
  return { ok: `${created} itens criados, ${updated} atualizados.` };
}

export async function updateItem(fd: FormData): Promise<void> {
  const id = str(fd.get("itemId"));
  if (!id) return;
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) return;
  const data: Record<string, unknown> = {};
  if (fd.has("name") && str(fd.get("name"))) data.name = str(fd.get("name"));
  if (fd.has("category")) data.category = str(fd.get("category")) || null;
  if (fd.has("notes")) data.notes = str(fd.get("notes")) || null;
  if (fd.has("active")) data.active = str(fd.get("active")) === "1";
  if (fd.has("listPrice")) {
    const price = num(fd.get("listPrice"));
    if (price > 0 && Math.abs(price - Number(item.listPrice ?? 0)) > 0.0001) {
      const from = isoDate(str(fd.get("effectiveFrom"))) ?? new Date();
      data.listPrice = price;
      data.listPriceAt = from;
      await prisma.inventoryItemPrice.create({ data: { itemId: id, price, effectiveFrom: from, source: str(fd.get("source")) || "MANUAL", note: str(fd.get("note")) || null } });
    }
  }
  if (Object.keys(data).length) await prisma.inventoryItem.update({ where: { id }, data });
  touch();
}

/** Aplica o preço sugerido (custo vigente ÷ (1 − margem)). */
export async function applySuggestedPrice(fd: FormData): Promise<void> {
  const id = str(fd.get("itemId"));
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item || !item.currentCost) return;
  const s = await getInventorySettings(item.companyId);
  const price = Math.round(priceForMargin(Number(item.currentCost), Number(s.marginPct)) * 100) / 100;
  await prisma.inventoryItem.update({ where: { id }, data: { listPrice: price, listPriceAt: new Date() } });
  await prisma.inventoryItemPrice.create({ data: { itemId: id, price, effectiveFrom: new Date(), source: "SUGGESTED", note: `custo ${Number(item.currentCost).toFixed(4)} · margem ${Number(s.marginPct)}%` } });
  touch();
}

/** Confirma que um nome do GL (venda/abertura) é este item. */
export async function mapGlName(fd: FormData): Promise<void> {
  const id = str(fd.get("itemId"));
  const glName = str(fd.get("glName"));
  if (!id || !glName) return;
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) return;
  // tira de qualquer outro item
  const others = await prisma.inventoryItem.findMany({ where: { companyId: item.companyId, glNames: { has: glName }, id: { not: id } } });
  for (const o of others) await prisma.inventoryItem.update({ where: { id: o.id }, data: { glNames: o.glNames.filter((g) => g !== glName) } });
  if (!item.glNames.includes(glName)) await prisma.inventoryItem.update({ where: { id }, data: { glNames: [...item.glNames, glName] } });
  touch();
}

export async function unmapGlName(fd: FormData): Promise<void> {
  const id = str(fd.get("itemId"));
  const glName = str(fd.get("glName"));
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) return;
  await prisma.inventoryItem.update({ where: { id }, data: { glNames: item.glNames.filter((g) => g !== glName) } });
  touch();
}

/** Confirma que o nome do produto na invoice da Archway é este item (e liga as linhas existentes). */
export async function mapVendorName(fd: FormData): Promise<void> {
  const id = str(fd.get("itemId"));
  const vendorName = str(fd.get("vendorName"));
  if (!id || !vendorName) return;
  const item = await prisma.inventoryItem.findUnique({ where: { id } });
  if (!item) return;
  const others = await prisma.inventoryItem.findMany({ where: { companyId: item.companyId, vendorNames: { has: vendorName }, id: { not: id } } });
  for (const o of others) await prisma.inventoryItem.update({ where: { id: o.id }, data: { vendorNames: o.vendorNames.filter((g) => g !== vendorName) } });
  if (!item.vendorNames.includes(vendorName)) await prisma.inventoryItem.update({ where: { id }, data: { vendorNames: [...item.vendorNames, vendorName] } });
  // linhas de produto com esse nome, em invoices da empresa
  const lines = await prisma.inventoryInvoiceLine.findMany({ where: { isProduct: true, invoice: { companyId: item.companyId } }, select: { id: true, activity: true } });
  const ids = lines.filter((l) => productName(l.activity).toLowerCase() === vendorName.toLowerCase()).map((l) => l.id);
  if (ids.length) await prisma.inventoryInvoiceLine.updateMany({ where: { id: { in: ids } }, data: { itemId: id } });
  touch();
}

/** "É o mesmo item que…": funde `fromId` em `intoId` (nomes, linhas, camadas congeladas, preços) e apaga o duplicado. */
export async function mergeItems(fd: FormData): Promise<void> {
  const fromId = str(fd.get("fromId"));
  const intoId = str(fd.get("intoId"));
  if (!fromId || !intoId || fromId === intoId) return;
  const [from, into] = await Promise.all([prisma.inventoryItem.findUnique({ where: { id: fromId } }), prisma.inventoryItem.findUnique({ where: { id: intoId } })]);
  if (!from || !into || from.companyId !== into.companyId) return;
  await prisma.inventoryItem.update({
    where: { id: intoId },
    data: {
      glNames: [...new Set([...into.glNames, from.name, ...from.glNames])],
      vendorNames: [...new Set([...into.vendorNames, ...from.vendorNames])],
      category: into.category ?? from.category,
      listPrice: into.listPrice ?? from.listPrice,
      listPriceAt: into.listPrice ? into.listPriceAt : from.listPriceAt,
      currentCost: into.currentCost ?? from.currentCost,
      currentCostAt: into.currentCost ? into.currentCostAt : from.currentCostAt,
      currentCostShipmentId: into.currentCost ? into.currentCostShipmentId : from.currentCostShipmentId,
      qtyOnHand: into.qtyOnHand ?? from.qtyOnHand,
    },
  });
  await prisma.inventoryInvoiceLine.updateMany({ where: { itemId: fromId }, data: { itemId: intoId } });
  await prisma.inventoryItemPrice.updateMany({ where: { itemId: fromId }, data: { itemId: intoId } });
  await prisma.inventoryInvoice.updateMany({ where: { sampleTargetItemId: fromId }, data: { sampleTargetItemId: intoId } });
  // camadas congeladas (closedData) que apontam para o item antigo
  const ships = await prisma.inventoryShipment.findMany({ where: { companyId: from.companyId, closedAt: { not: null } }, select: { id: true, closedData: true } });
  for (const s of ships) {
    const d = s.closedData as { items?: { itemId: string | null }[] } | null;
    if (!d?.items?.some((i) => i.itemId === fromId)) continue;
    d.items = d.items.map((i) => (i.itemId === fromId ? { ...i, itemId: intoId } : i));
    await prisma.inventoryShipment.update({ where: { id: s.id }, data: { closedData: JSON.parse(JSON.stringify(d)) } });
  }
  await prisma.inventoryItem.delete({ where: { id: fromId } });
  touch();
}

// ─── invoices ────────────────────────────────────────────────────────────────

export type SubmitInvoiceResult =
  | { status: "created"; id: string; no: string }
  | { status: "same"; id: string; no: string; attachedPdf: boolean }
  | { status: "differs"; id: string; no: string; existing: { date: string; total: number; lines: number; fileName: string | null; createdAt: string }; incoming: { date: string | null; total: number | null; lines: number } }
  | { status: "replaced"; id: string; no: string }
  | { status: "error"; no: string | null; error: string };

type LineInput = { activity: string; desc: string; qty: number | null; rate: number | null; amount: number };

async function lineItemIds(companyId: string, lines: LineInput[]): Promise<(string | null)[]> {
  const items = await prisma.inventoryItem.findMany({ where: { companyId }, select: { id: true, vendorNames: true } });
  const byVendor = new Map<string, string>();
  for (const it of items) for (const v of it.vendorNames) byVendor.set(v.toLowerCase(), it.id);
  return lines.map((l) => (isProductActivity(l.activity) ? byVendor.get(productName(l.activity).toLowerCase()) ?? null : null));
}

function toLines(parsed: ParsedInvoice): LineInput[] {
  return parsed.lines.map((l) => ({ activity: l.activity, desc: (l.desc ?? []).join("\n"), qty: l.qty, rate: l.rate, amount: l.amount ?? 0 }));
}

/**
 * Entrada de invoice lida no navegador (PDF) — uma por chamada. FormData: companyId, parsed (JSON de
 * ParsedInvoice), kind (GOODS|FREIGHT|SAMPLE), fileName, file (PDF, opcional), replace ("1" confirma a
 * substituição quando o número já existe com total diferente).
 */
export async function submitInvoice(fd: FormData): Promise<SubmitInvoiceResult> {
  const companyId = str(fd.get("companyId"));
  let parsed: ParsedInvoice;
  try {
    parsed = JSON.parse(str(fd.get("parsed"))) as ParsedInvoice;
  } catch {
    return { status: "error", no: null, error: "Leitura inválida." };
  }
  if (!companyId) return { status: "error", no: parsed.no, error: "Empresa?" };
  if (!parsed.no) return { status: "error", no: null, error: "Sem número de invoice." };
  const s = await getInventorySettings(companyId);
  const vendorName = pickVendor(s, str(fd.get("vendor")));
  const kindRaw = str(fd.get("kind"));
  const kind = kindRaw === "FREIGHT" || kindRaw === "SAMPLE" || kindRaw === "GOODS" ? kindRaw : parsed.lines.some((l) => isProductActivity(l.activity)) ? "GOODS" : "FREIGHT";
  const dateIso = usDateToIso(parsed.date) ?? str(fd.get("date"));
  const date = isoDate(dateIso);
  if (!date) return { status: "error", no: parsed.no, error: "Data da invoice não lida." };
  const total = parsed.total ?? 0;
  const file = fd.get("file");
  const pdf = file instanceof File && file.size > 0 ? Buffer.from(await file.arrayBuffer()) : null;
  const fileName = str(fd.get("fileName")) || (file instanceof File ? file.name : null) || null;
  const lines = toLines(parsed);
  const containers = containersOf(parsed.container, parsed.memo);
  const refs = refsOf(parsed.memo, parsed.no).map((r) => r.no);

  const existing = await prisma.inventoryInvoice.findUnique({ where: { companyId_vendorName_no: { companyId, vendorName, no: parsed.no } }, include: { lines: true } });
  if (existing) {
    const sameTotal = Math.abs(Number(existing.total) - total) < 0.005;
    if (sameTotal) {
      let attached = false;
      if (pdf && !existing.pdf) {
        await prisma.inventoryInvoice.update({ where: { id: existing.id }, data: { pdf, pdfSize: pdf.length, fileName } });
        attached = true;
      }
      touch();
      return { status: "same", id: existing.id, no: parsed.no, attachedPdf: attached };
    }
    if (str(fd.get("replace")) !== "1")
      return {
        status: "differs",
        id: existing.id,
        no: parsed.no,
        existing: { date: existing.date.toISOString().slice(0, 10), total: Number(existing.total), lines: existing.lines.length, fileName: existing.fileName, createdAt: existing.createdAt.toISOString() },
        incoming: { date: dateIso, total, lines: lines.length },
      };
    // substituição: guarda a versão anterior e regrava
    const snapshot = { ...existing, pdf: undefined, total: Number(existing.total), subtotal: Number(existing.subtotal), lines: existing.lines.map((l) => ({ ...l, qty: l.qty == null ? null : Number(l.qty), rate: l.rate == null ? null : Number(l.rate), amount: Number(l.amount) })) };
    await prisma.inventoryInvoiceVersion.create({ data: { invoiceId: existing.id, snapshot: JSON.parse(JSON.stringify(snapshot)), reason: "mesmo número, total diferente", replacedBy: await who() } });
    const itemIds = await lineItemIds(companyId, lines);
    await prisma.$transaction([
      prisma.inventoryInvoiceLine.deleteMany({ where: { invoiceId: existing.id } }),
      prisma.inventoryInvoice.update({
        where: { id: existing.id },
        data: {
          date,
          kind,
          containers,
          refs,
          memo: parsed.memo,
          subtotal: parsed.subtotal ?? total,
          discount: parsed.discount ?? 0,
          tax: parsed.tax ?? 0,
          total,
          payment: parsed.payment,
          balance: parsed.balance,
          linesOk: linesClose(parsed),
          source: pdf ? "PDF" : "MANUAL",
          ...(pdf ? { pdf, pdfSize: pdf.length, fileName } : {}),
          lines: { create: lines.map((l, i) => ({ sort: i, activity: l.activity, desc: l.desc || null, qty: l.qty, rate: l.rate, amount: l.amount, isProduct: isProductActivity(l.activity), costGroup: isProductActivity(l.activity) ? null : classifyCost(l.activity, l.desc), itemId: itemIds[i] })) },
        },
      }),
    ]);
    await recomputeShipments(companyId);
    touch();
    return { status: "replaced", id: existing.id, no: parsed.no };
  }

  const itemIds = await lineItemIds(companyId, lines);
  const created = await prisma.inventoryInvoice.create({
    data: {
      companyId,
      vendorName,
      no: parsed.no,
      date,
      kind,
      containers,
      refs,
      memo: parsed.memo,
      subtotal: parsed.subtotal ?? total,
      discount: parsed.discount ?? 0,
      tax: parsed.tax ?? 0,
      total,
      payment: parsed.payment,
      balance: parsed.balance,
      linesOk: linesClose(parsed),
      source: pdf ? "PDF" : "MANUAL",
      fileName,
      pdf,
      pdfSize: pdf?.length ?? null,
      lines: { create: lines.map((l, i) => ({ sort: i, activity: l.activity, desc: l.desc || null, qty: l.qty, rate: l.rate, amount: l.amount, isProduct: isProductActivity(l.activity), costGroup: isProductActivity(l.activity) ? null : classifyCost(l.activity, l.desc), itemId: itemIds[i] })) },
    },
  });
  await recomputeShipments(companyId);
  touch();
  return { status: "created", id: created.id, no: parsed.no };
}

/** Cria a invoice a partir da bill do fornecedor no GL (sem PDF): linhas por conta. */
export async function createInvoiceFromGl(_p: InvState, fd: FormData): Promise<InvState> {
  const companyId = str(fd.get("companyId"));
  const numBill = str(fd.get("num"));
  if (!companyId || !numBill) return { error: "Bill?" };
  const s = await getInventorySettings(companyId);
  const rows = await prisma.ledgerTxn.findMany({ where: { companyId, num: numBill, type: "Bill", OR: s.vendorKeys.map((k) => ({ rawName: { contains: k, mode: "insensitive" as const } })) }, orderBy: { amount: "desc" } });
  const lines = rows.filter((r) => !/Accounts Payable/i.test(r.account));
  if (!lines.length) return { error: `Bill ${numBill} não encontrada no GL.` };
  const vendorName = vendorOfRawName(rows[0].rawName, s.vendors) ?? s.vendorName;
  const exists = await prisma.inventoryInvoice.findUnique({ where: { companyId_vendorName_no: { companyId, vendorName, no: numBill } } });
  if (exists) return { error: `Invoice ${numBill} já existe.` };
  const date = lines[0].date;
  const memo = [...new Set(rows.map((l) => (l.description ?? "").trim()).filter(Boolean))]; // inclui a linha de A/P: é onde vem "Container: …"
  const li: LineInput[] = lines.map((l) => {
    const a = Number(l.amount);
    if (l.account === s.glInventoryAccount) return { activity: `Products:${glItemName(l.description)}`, desc: (l.description ?? "").split("\n").slice(1).join("\n"), qty: null, rate: null, amount: a };
    if (l.account === s.glFreightAccount) return { activity: "Shipping and Handling:Shipping and Handling", desc: l.description ?? "", qty: 1, rate: a, amount: a };
    if (/bank/i.test(l.account)) return { activity: "Bank Charges", desc: l.description ?? "", qty: 1, rate: a, amount: a };
    if (/labor|service/i.test(l.account)) return { activity: "Professional Services", desc: l.description ?? "", qty: 1, rate: a, amount: a };
    return { activity: l.account, desc: l.description ?? "", qty: 1, rate: a, amount: a };
  });
  const total = r2(li.reduce((x, l) => x + l.amount, 0));
  const kind = li.some((l) => isProductActivity(l.activity)) ? "GOODS" : "FREIGHT";
  const containerTxt = memo.find((m) => /container/i.test(m)) ?? null;
  const itemIds = await lineItemIds(companyId, li);
  await prisma.inventoryInvoice.create({
    data: {
      companyId,
      vendorName,
      no: numBill,
      date,
      kind,
      containers: containersOf(containerTxt, memo),
      refs: refsOf(memo, numBill).map((r) => r.no),
      memo,
      subtotal: total,
      total,
      linesOk: true,
      source: "GL",
      glNum: numBill,
      lines: { create: li.map((l, i) => ({ sort: i, activity: l.activity, desc: l.desc || null, qty: l.qty, rate: l.rate, amount: l.amount, isProduct: isProductActivity(l.activity), costGroup: isProductActivity(l.activity) ? null : classifyCost(l.activity, l.desc), itemId: itemIds[i] })) },
    },
  });
  await recomputeShipments(companyId);
  touch();
  return { ok: `Invoice ${numBill} criada a partir do GL (${kind === "GOODS" ? "mercadoria" : "frete"}, $${total.toFixed(2)}).` };
}

/** Invoice digitada (sem PDF): cabeçalho + linhas em JSON [{activity,desc,qty,rate,amount}]. */
export async function createInvoiceManual(_p: InvState, fd: FormData): Promise<InvState> {
  const companyId = str(fd.get("companyId"));
  const no = str(fd.get("no"));
  const date = isoDate(str(fd.get("date")));
  const kindRaw = str(fd.get("kind"));
  const kind = kindRaw === "FREIGHT" || kindRaw === "SAMPLE" ? kindRaw : "GOODS";
  if (!companyId || !no || !date) return { error: "Número e data são obrigatórios." };
  let lines: LineInput[] = [];
  try {
    lines = (JSON.parse(str(fd.get("lines")) || "[]") as LineInput[]).filter((l) => l.activity && Number.isFinite(Number(l.amount)));
  } catch {
    return { error: "Linhas inválidas." };
  }
  if (!lines.length) return { error: "Pelo menos uma linha." };
  const s = await getInventorySettings(companyId);
  const vendorName = pickVendor(s, str(fd.get("vendor")));
  const exists = await prisma.inventoryInvoice.findUnique({ where: { companyId_vendorName_no: { companyId, vendorName, no } } });
  if (exists) return { error: `Invoice ${no} já existe. Solte o PDF para comparar/substituir.` };
  const memo = str(fd.get("memo")).split("\n").map((x) => x.trim()).filter(Boolean);
  const container = str(fd.get("container")) || null;
  const total = r2(lines.reduce((x, l) => x + Number(l.amount), 0) + num(fd.get("discount")) + num(fd.get("tax")));
  const itemIds = await lineItemIds(companyId, lines);
  await prisma.inventoryInvoice.create({
    data: {
      companyId,
      vendorName,
      no,
      date,
      kind,
      containers: containersOf(container, memo),
      refs: refsOf(memo, no).map((r) => r.no),
      memo: container ? [`Container: ${container}`, ...memo] : memo,
      subtotal: r2(lines.reduce((x, l) => x + Number(l.amount), 0)),
      discount: num(fd.get("discount")),
      tax: num(fd.get("tax")),
      total,
      linesOk: true,
      source: "MANUAL",
      lines: { create: lines.map((l, i) => ({ sort: i, activity: l.activity, desc: l.desc || null, qty: l.qty == null || l.qty === ("" as unknown) ? null : Number(l.qty), rate: l.rate == null || l.rate === ("" as unknown) ? null : Number(l.rate), amount: Number(l.amount), isProduct: isProductActivity(l.activity), costGroup: isProductActivity(l.activity) ? null : classifyCost(l.activity, l.desc), itemId: itemIds[i] })) },
    },
  });
  await recomputeShipments(companyId);
  touch();
  return { ok: `Invoice ${no} lançada.` };
}

export async function setInvoiceKind(fd: FormData): Promise<void> {
  const id = str(fd.get("invoiceId"));
  const kindRaw = str(fd.get("kind"));
  const kind = kindRaw === "FREIGHT" || kindRaw === "SAMPLE" ? kindRaw : "GOODS";
  const inv = await prisma.inventoryInvoice.update({ where: { id }, data: { kind } });
  await recomputeShipments(inv.companyId);
  touch();
}

export async function pinInvoice(fd: FormData): Promise<void> {
  const id = str(fd.get("invoiceId"));
  const shipmentId = str(fd.get("shipmentId")) || null;
  const inv = await prisma.inventoryInvoice.update({ where: { id }, data: { pinShipmentId: shipmentId } });
  await recomputeShipments(inv.companyId);
  touch();
}

export async function setSampleTarget(fd: FormData): Promise<void> {
  const id = str(fd.get("invoiceId"));
  const itemId = str(fd.get("itemId")) || null;
  const shipmentId = str(fd.get("shipmentId")) || null;
  await prisma.inventoryInvoice.update({ where: { id }, data: { sampleTargetItemId: itemId, shipmentId, pinShipmentId: shipmentId } });
  touch();
}

export async function writeOffSample(fd: FormData): Promise<void> {
  const id = str(fd.get("invoiceId"));
  const date = isoDate(str(fd.get("date"))) ?? new Date();
  await prisma.inventoryInvoice.update({ where: { id }, data: { sampleWrittenOffAt: date, shipmentId: null, pinShipmentId: null } });
  touch();
}

export async function deleteInvoice(fd: FormData): Promise<void> {
  const id = str(fd.get("invoiceId"));
  const inv = await prisma.inventoryInvoice.findUnique({ where: { id }, include: { shipment: { select: { closedAt: true } } } });
  if (!inv) return;
  if (inv.shipment?.closedAt && !inv.lateAdjustment) return; // faz parte de camada fechada: não apaga
  await prisma.inventoryInvoice.delete({ where: { id } });
  await recomputeShipments(inv.companyId);
  touch();
}

// ─── shipments ───────────────────────────────────────────────────────────────

export async function renameShipment(fd: FormData): Promise<void> {
  const id = str(fd.get("shipmentId"));
  await prisma.inventoryShipment.update({ where: { id }, data: { name: str(fd.get("name")) || null, note: fd.has("note") ? str(fd.get("note")) || null : undefined } });
  touch();
}

/** "Fechar custos": congela a camada na data da entrega; atualiza o custo vigente dos itens mapeados. */
export async function closeShipmentCosts(_p: InvState, fd: FormData): Promise<InvState> {
  const id = str(fd.get("shipmentId"));
  const force = str(fd.get("force")) === "1";
  const sh = await prisma.inventoryShipment.findUnique({ where: { id } });
  if (!sh) return { error: "Embarque?" };
  if (sh.closedAt) return { error: "Custos já fechados." };
  const s = await getInventorySettings(sh.companyId);
  await recomputeShipments(sh.companyId);
  const all = await loadInvoices(sh.companyId);
  const v = buildShipmentView(all, id, s.closeHintTerms);
  if (!v.goods.length) return { error: "Sem invoice de mercadoria no embarque." };
  if (v.missingRefs.length && !force) return { error: `Faltam invoices citadas: ${v.missingRefs.join(", ")}. Marque "fechar mesmo assim" se não vierem.` };
  const unmapped = v.items.filter((i) => !i.itemId);
  if (unmapped.length && !force) return { error: `Itens sem par no QBO: ${unmapped.map((i) => i.name).join(", ")}. Confirme em Items & prices ou force.` };
  const deliveredAt = sh.deliveredAt ?? v.freights.map((f) => f.date).sort((a, b) => b.getTime() - a.getTime())[0] ?? new Date();
  const data = toClosedData(v);
  await prisma.inventoryShipment.update({ where: { id }, data: { closedAt: new Date(), closedBy: await who(), closedData: JSON.parse(JSON.stringify(data)), deliveredAt } });
  // custo vigente dos itens = unitário desembarcado deste embarque
  for (const it of v.items) if (it.itemId && it.qty > 0) await prisma.inventoryItem.update({ where: { id: it.itemId }, data: { currentCost: Math.round(it.unitCost * 10000) / 10000, currentCostAt: deliveredAt, currentCostShipmentId: id } });
  touch();
  const below = await itemsBelowMargin(sh.companyId, v.items.map((i) => i.itemId).filter(Boolean) as string[]);
  return { ok: `Custos fechados em ${deliveredAt.toISOString().slice(0, 10)} · absorção ${(v.absorption * 100).toFixed(1)}%${below.length ? ` · ${below.length} item(ns) abaixo da margem: ${below.join(", ")}` : ""}` };
}

async function itemsBelowMargin(companyId: string, itemIds: string[]): Promise<string[]> {
  const s = await getInventorySettings(companyId);
  const items = await prisma.inventoryItem.findMany({ where: { id: { in: itemIds } } });
  return items.filter((i) => i.listPrice && i.currentCost && 1 - Number(i.currentCost) / Number(i.listPrice) < Number(s.marginPct) / 100).map((i) => i.name);
}

/** Reabre (só se nenhum mês foi fechado a partir da entrega). */
export async function reopenShipment(fd: FormData): Promise<void> {
  const id = str(fd.get("shipmentId"));
  const sh = await prisma.inventoryShipment.findUnique({ where: { id } });
  if (!sh || !sh.closedAt || sh.isOpening) return;
  const m = (sh.deliveredAt ?? new Date()).toISOString().slice(0, 7);
  const closed = await prisma.inventoryClosing.count({ where: { companyId: sh.companyId, month: { gte: m } } });
  if (closed) return;
  await prisma.inventoryShipment.update({ where: { id }, data: { closedAt: null, closedBy: null, closedData: undefined } });
  await prisma.inventoryInvoice.updateMany({ where: { shipmentId: id }, data: { lateAdjustment: false } });
  touch();
}

/** Camada de ABERTURA: material por item do GL ("Inventory Starting Value") + frete capitalizado informado. */
export async function createOpening(_p: InvState, fd: FormData): Promise<InvState> {
  const companyId = str(fd.get("companyId"));
  const date = isoDate(str(fd.get("date")));
  const freight = num(fd.get("freight"));
  if (!companyId || !date) return { error: "Data da abertura?" };
  if (await prisma.inventoryShipment.findFirst({ where: { companyId, isOpening: true } })) return { error: "Abertura já existe." };
  const s = await getInventorySettings(companyId);
  const gl = await loadGlData(companyId, s);
  const entries = Object.entries(gl.openingByName).filter(([, v]) => v.amount > 0.005);
  if (!entries.length) return { error: "GL sem 'Inventory Starting Value'. Suba o GL da empresa." };
  const merch = r2(entries.reduce((x, [, v]) => x + v.amount, 0));
  // garante item p/ cada nome
  const items: { itemId: string; name: string; amount: number }[] = [];
  for (const [raw, v] of entries) {
    let it = await prisma.inventoryItem.findFirst({ where: { companyId, OR: [{ glNames: { has: raw } }, { name: v.cleanName }, { glNames: { has: v.cleanName } }] } });
    if (!it) it = await prisma.inventoryItem.create({ data: { companyId, name: v.cleanName, category: v.category, glNames: [...new Set([v.cleanName, raw])] } });
    else if (!it.glNames.includes(raw)) await prisma.inventoryItem.update({ where: { id: it.id }, data: { glNames: [...it.glNames, raw] } });
    items.push({ itemId: it.id, name: it.name, amount: v.amount });
  }
  const data = {
    merch,
    pool: r2(freight),
    absorption: merch ? freight / merch : 0,
    items: items.map((i) => ({ itemId: i.itemId, name: i.name, invNo: "abertura", qty: 0, amount: r2(i.amount), alloc: r2(merch ? (freight * i.amount) / merch : 0), unitCost: 0 })),
    invoices: [],
  };
  await prisma.inventoryShipment.create({ data: { companyId, key: "opening", name: "Abertura", isOpening: true, deliveredAt: date, closedAt: new Date(), closedBy: await who(), closedData: data } });
  touch();
  return { ok: `Abertura criada: material $${merch.toFixed(2)} em ${items.length} itens · frete $${freight.toFixed(2)} · absorção ${(data.absorption * 100).toFixed(1)}%.` };
}

/** Edita a abertura (data/frete). Livre enquanto nenhum embarque fechou; depois só ADMIN. */
export async function updateOpening(_p: InvState, fd: FormData): Promise<InvState> {
  const companyId = str(fd.get("companyId"));
  const date = isoDate(str(fd.get("date")));
  const freight = num(fd.get("freight"));
  if (!companyId || !date) return { error: "Data da abertura?" };
  const op = await prisma.inventoryShipment.findFirst({ where: { companyId, isOpening: true } });
  if (!op) return { error: "Abertura não existe." };
  const closedOthers = await prisma.inventoryShipment.count({ where: { companyId, isOpening: false, closedAt: { not: null } } });
  if (closedOthers && !(await isAdmin())) return { error: `Já há ${closedOthers} embarque(s) com custos fechados: só um administrador altera a abertura.` };
  const d = op.closedData as unknown as { merch: number; pool: number; absorption: number; items: { itemId: string | null; name: string; invNo: string; qty: number; amount: number; alloc: number; unitCost: number }[]; invoices: unknown[] };
  const merch = d.merch;
  const data = { ...d, pool: r2(freight), absorption: merch ? freight / merch : 0, items: d.items.map((i) => ({ ...i, alloc: r2(merch ? (freight * i.amount) / merch : 0) })) };
  await prisma.inventoryShipment.update({ where: { id: op.id }, data: { deliveredAt: date, closedAt: new Date(), closedBy: await who(), closedData: JSON.parse(JSON.stringify(data)) } });
  touch();
  return { ok: `Abertura atualizada: frete $${freight.toFixed(2)} · absorção ${(data.absorption * 100).toFixed(1)}%.` };
}

// ─── month-end ───────────────────────────────────────────────────────────────

export async function closeMonth(_p: InvState, fd: FormData): Promise<InvState> {
  const companyId = str(fd.get("companyId"));
  const month = str(fd.get("month"));
  if (!companyId || !/^\d{4}-\d{2}$/.test(month)) return { error: "Mês?" };
  const s = await getInventorySettings(companyId);
  const res = await runFifo(companyId, s, month);
  const row = res.rows.find((r) => r.month === month);
  if (!row) return { error: "Sem movimento nesse mês." };
  if (isClosedBooks(s, month)) return { error: `Livros fechados até ${s.booksClosedThrough ?? "o ano passado"}: o ajuste deste mês entra no primeiro mês aberto.` };
  const manual = str(fd.get("merchEnd"));
  const merchEnd = row.glMatStock ?? (manual ? num(manual) : null);
  if (merchEnd == null) return { error: "GL do mês não carregado: informe o estoque final de material." };
  await prisma.inventoryClosing.upsert({
    where: { companyId_month: { companyId, month } },
    create: { companyId, month, merchEnd, merchEndSource: row.glMatStock != null ? "GL" : "MANUAL", cogsMerch: row.matOut, freightOut: row.suggested, data: JSON.parse(JSON.stringify({ detail: row.detail, noLayer: row.noLayer, lateAdj: row.lateAdj, catchUp: row.catchUp })) },
    update: { merchEnd, merchEndSource: row.glMatStock != null ? "GL" : "MANUAL", cogsMerch: row.matOut, freightOut: row.suggested, data: JSON.parse(JSON.stringify({ detail: row.detail, noLayer: row.noLayer, lateAdj: row.lateAdj, catchUp: row.catchUp })) },
  });
  touch();
  return { ok: `${month} fechado: JE de ajuste $${(row.catchUp ?? row.suggested).toFixed(2)} (frete do mês $${row.suggested.toFixed(2)}).` };
}

export async function markJeBooked(fd: FormData): Promise<void> {
  const companyId = str(fd.get("companyId"));
  const month = str(fd.get("month"));
  const undo = str(fd.get("undo")) === "1";
  const c = await prisma.inventoryClosing.findUnique({ where: { companyId_month: { companyId, month } } });
  if (!c) return;
  await prisma.inventoryClosing.update({ where: { id: c.id }, data: undo ? { jeBookedAt: null, jeBookedAmount: null } : { jeBookedAt: isoDate(str(fd.get("date"))) ?? new Date(), jeBookedAmount: num(fd.get("amount")) || c.freightOut } });
  touch();
}

export async function deleteClosing(fd: FormData): Promise<void> {
  const companyId = str(fd.get("companyId"));
  const month = str(fd.get("month"));
  await prisma.inventoryClosing.deleteMany({ where: { companyId, month } });
  touch();
}
