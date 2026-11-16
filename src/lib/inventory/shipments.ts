/**
 * Inventory — formação do embarque e rateio.
 * O embarque é o componente conexo das invoices de FRETE: duas ficam juntas quando citam o
 * mesmo container OU a mesma invoice de mercadoria (é assim que a invoice partida entre dois
 * containers se resolve). A invoice de mercadoria entra no embarque que a cita (ou no pin).
 * Entrega = data da ÚLTIMA invoice de frete. O custo fecha só em "Fechar custos" (camada
 * congelada em closedData). Regras: memória vixus-inventory-import-module.
 */

import { prisma } from "@/lib/db";
import { classifyCost, isProductActivity, productName, hasCloseHint } from "./classify";

export type InvoiceRow = {
  id: string;
  no: string;
  date: Date;
  kind: "GOODS" | "FREIGHT" | "SAMPLE";
  containers: string[];
  refs: string[];
  pinShipmentId: string | null;
  shipmentId: string | null;
  total: number;
  discount: number;
  tax: number;
  lateAdjustment: boolean;
  lines: { id: string; activity: string; desc: string | null; qty: number | null; rate: number | null; amount: number; isProduct: boolean; costGroup: string | null; itemId: string | null }[];
};

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export async function loadInvoices(companyId: string): Promise<InvoiceRow[]> {
  const rows = await prisma.inventoryInvoice.findMany({
    where: { companyId },
    include: { lines: { orderBy: { sort: "asc" } } },
    orderBy: { date: "asc" },
  });
  return rows.map((i) => ({
    id: i.id,
    no: i.no,
    date: i.date,
    kind: i.kind,
    containers: i.containers,
    refs: i.refs,
    pinShipmentId: i.pinShipmentId,
    shipmentId: i.shipmentId,
    total: n(i.total),
    discount: n(i.discount),
    tax: n(i.tax),
    lateAdjustment: i.lateAdjustment,
    lines: i.lines.map((l) => ({ id: l.id, activity: l.activity, desc: l.desc, qty: l.qty == null ? null : n(l.qty), rate: l.rate == null ? null : n(l.rate), amount: n(l.amount), isProduct: l.isProduct, costGroup: l.costGroup, itemId: l.itemId })),
  }));
}

/** Chave estável do grupo: containers ordenados, senão o nº da primeira invoice de frete. */
const groupKey = (members: InvoiceRow[]) => {
  const cs = [...new Set(members.flatMap((m) => m.containers))].sort();
  return cs.length ? cs.join("+") : `inv:${members.map((m) => m.no).sort()[0]}`;
};

/**
 * Recalcula a composição dos embarques da empresa e grava shipmentId em cada invoice.
 * Embarque já FECHADO mantém id (a camada é dele); invoices de frete que entrarem depois do
 * fechamento viram lateAdjustment. Devolve os ids dos embarques vivos.
 */
export async function recomputeShipments(companyId: string): Promise<void> {
  const inv = await loadInvoices(companyId);
  const fr = inv.filter((i) => i.kind === "FREIGHT");
  // union-find
  const parent = fr.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const uni = (a: number, b: number) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent[b] = a;
  };
  const seen = new Map<string, number>();
  fr.forEach((f, i) => {
    const keys = [...f.containers.map((c) => `c:${c}`), ...f.refs.map((r) => `i:${r}`), ...(f.pinShipmentId ? [`s:${f.pinShipmentId}`] : [])];
    for (const k of keys) {
      if (seen.has(k)) uni(seen.get(k)!, i);
      else seen.set(k, i);
    }
  });
  const groups = new Map<number, InvoiceRow[]>();
  fr.forEach((f, i) => {
    const r = find(i);
    (groups.get(r) ?? groups.set(r, []).get(r)!).push(f);
  });

  const existing = await prisma.inventoryShipment.findMany({ where: { companyId, isOpening: false }, include: { invoices: { select: { id: true, kind: true } } } });
  const keepIds = new Set<string>();
  const assign = new Map<string, string>(); // invoiceId → shipmentId

  for (const [, members] of groups) {
    const ids = new Set(members.map((m) => m.id));
    const key = groupKey(members);
    // embarques antigos que contêm alguma destas invoices de frete; o fechado manda
    const olds = existing.filter((s) => s.invoices.some((x) => x.kind === "FREIGHT" && ids.has(x.id)));
    let sh = olds.find((s) => s.closedAt) ?? olds.find((s) => s.key === key) ?? olds[0] ?? null;
    const containers = [...new Set(members.flatMap((m) => m.containers))].sort();
    const deliveredAt = members.map((m) => m.date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    if (!sh) {
      const byKey = existing.find((s) => s.key === key);
      sh = byKey ?? (await prisma.inventoryShipment.create({ data: { companyId, key, containers, deliveredAt }, include: { invoices: { select: { id: true, kind: true } } } }));
    }
    // chave: se mudou (containers novos) e não colide, atualiza
    const collide = existing.find((s) => s.key === key && s.id !== sh!.id && !keepIds.has(s.id));
    await prisma.inventoryShipment.update({
      where: { id: sh.id },
      data: { containers, deliveredAt: sh.closedAt ? sh.deliveredAt : deliveredAt, ...(collide ? {} : { key }) },
    });
    keepIds.add(sh.id);
    for (const m of members) assign.set(m.id, sh.id);
    // mercadoria citada (ou pinada) entra junto
    const refs = new Set(members.flatMap((m) => m.refs));
    for (const i of inv) {
      if (i.kind === "SAMPLE") continue;
      if (i.pinShipmentId === sh.id) assign.set(i.id, sh.id);
      else if (i.kind === "GOODS" && !i.pinShipmentId && refs.has(i.no) && !assign.has(i.id)) assign.set(i.id, sh.id);
    }
  }
  // pin de mercadoria p/ embarque sem frete citando (ex.: resposta do fornecedor)
  for (const i of inv) if (!assign.has(i.id) && i.pinShipmentId && (keepIds.has(i.pinShipmentId) || existing.some((s) => s.id === i.pinShipmentId))) assign.set(i.id, i.pinShipmentId);

  // grava
  for (const i of inv) {
    const sid = assign.get(i.id) ?? null;
    const sh = sid ? existing.find((s) => s.id === sid) : null;
    const late = !!(sh?.closedAt && i.kind === "FREIGHT" && i.date.getTime() > sh.closedAt.getTime() && !sh.invoices.some((x) => x.id === i.id));
    if (i.shipmentId !== sid || (late && !i.lateAdjustment))
      await prisma.inventoryInvoice.update({ where: { id: i.id }, data: { shipmentId: sid, ...(late ? { lateAdjustment: true } : {}) } });
  }
  // embarques (não fechados, não abertura) que ficaram sem frete somem
  for (const s of existing) if (!keepIds.has(s.id) && !s.closedAt) await prisma.inventoryShipment.delete({ where: { id: s.id } }).catch(() => undefined);
}

// ─── rateio ────────────────────────────────────────────────────────────────

export type AllocItem = {
  key: string; // nome do produto na invoice (normalizado)
  name: string;
  itemId: string | null;
  invNo: string;
  qty: number;
  amount: number; // valor de fábrica (inclui sample diluído)
  alloc: number; // custos rateados
  unitFob: number;
  unitCost: number;
  hasSample: boolean;
};
export type ShipmentView = {
  goods: InvoiceRow[];
  freights: InvoiceRow[];
  samples: InvoiceRow[];
  missingRefs: string[]; // invoices citadas que não estão no acervo
  items: AllocItem[];
  costs: { label: string; group: string; invNo: string; amount: number }[];
  merch: number;
  pool: number;
  landed: number;
  absorption: number; // pool / merch
  closeHint: string | null;
  lateFreight: InvoiceRow[]; // frete após fechamento (não entra na camada)
};

export function buildShipmentView(
  all: InvoiceRow[],
  shipmentId: string,
  closeHintTerms: string[],
  opts: { excludeLate?: boolean } = {},
): ShipmentView {
  const list = all.filter((i) => i.shipmentId === shipmentId);
  const goods = list.filter((i) => i.kind === "GOODS");
  const freightsAll = list.filter((i) => i.kind === "FREIGHT");
  const lateFreight = freightsAll.filter((i) => i.lateAdjustment);
  const freights = opts.excludeLate === false ? freightsAll : freightsAll.filter((i) => !i.lateAdjustment);
  const present = new Set(all.map((i) => i.no));
  const refs = [...new Set(freightsAll.flatMap((f) => f.refs))];
  const missingRefs = refs.filter((r) => !present.has(r));

  const items: AllocItem[] = [];
  const costs: ShipmentView["costs"] = [];
  const push = (inv: InvoiceRow) => {
    for (const l of inv.lines) {
      if (l.isProduct || isProductActivity(l.activity)) {
        const name = productName(l.activity);
        const key = name.toLowerCase();
        const it = items.find((x) => x.key === key && x.invNo === inv.no);
        if (it) {
          it.qty += l.qty ?? 0;
          it.amount += l.amount;
        } else items.push({ key, name, itemId: l.itemId, invNo: inv.no, qty: l.qty ?? 0, amount: l.amount, alloc: 0, unitFob: 0, unitCost: 0, hasSample: false });
      } else costs.push({ label: l.activity, group: l.costGroup ?? classifyCost(l.activity, l.desc ?? ""), invNo: inv.no, amount: l.amount });
    }
    if (inv.discount) costs.push({ label: "Desconto de fábrica", group: "other", invNo: inv.no, amount: inv.discount });
    if (inv.tax) costs.push({ label: "Impostos na invoice", group: "other", invNo: inv.no, amount: inv.tax });
  };
  for (const g of goods) push(g);
  for (const f of freights) push(f);

  // samples deste embarque: o custo TOTAL da invoice de sample dilui no produto (não no embarque)
  const samples = all.filter((i) => i.kind === "SAMPLE" && i.shipmentId === shipmentId);
  for (const s of samples) {
    const ps = s.lines.filter((l) => l.isProduct || isProductActivity(l.activity));
    const base = ps.reduce((a, l) => a + l.amount, 0) || 1;
    for (const l of ps) {
      const key = productName(l.activity).toLowerCase();
      const full = s.total * (l.amount / base);
      const it = items.find((x) => x.key === key || (l.itemId && x.itemId === l.itemId));
      if (it) {
        it.qty += l.qty ?? 0;
        it.amount += full;
        it.hasSample = true;
      }
    }
  }

  const merch = items.reduce((s, i) => s + i.amount, 0);
  const pool = costs.reduce((s, c) => s + c.amount, 0);
  for (const it of items) {
    it.alloc = merch ? pool * (it.amount / merch) : 0; // critério: valor
    it.unitFob = it.qty ? it.amount / it.qty : 0;
    it.unitCost = it.qty ? (it.amount + it.alloc) / it.qty : 0;
  }
  items.sort((a, b) => b.amount + b.alloc - (a.amount + a.alloc));
  const closeHint = freights.map((f) => hasCloseHint(f.lines, closeHintTerms)).find(Boolean) ?? null;
  return { goods, freights, samples, missingRefs, items, costs, merch: r2(merch), pool: r2(pool), landed: r2(merch + pool), absorption: merch ? pool / merch : 0, closeHint, lateFreight };
}

/** Snapshot congelado gravado em closedData no "Fechar custos". */
export type ClosedData = {
  merch: number;
  pool: number;
  absorption: number;
  items: { itemId: string | null; name: string; invNo: string; qty: number; amount: number; alloc: number; unitCost: number }[];
  invoices: { id: string; no: string; kind: string; total: number }[];
};

export function toClosedData(v: ShipmentView): ClosedData {
  return {
    merch: v.merch,
    pool: v.pool,
    absorption: v.absorption,
    items: v.items.map((i) => ({ itemId: i.itemId, name: i.name, invNo: i.invNo, qty: r2(i.qty), amount: r2(i.amount), alloc: r2(i.alloc), unitCost: Math.round(i.unitCost * 10000) / 10000 })),
    invoices: [...v.goods, ...v.freights, ...v.samples].map((i) => ({ id: i.id, no: i.no, kind: i.kind, total: i.total })),
  };
}
