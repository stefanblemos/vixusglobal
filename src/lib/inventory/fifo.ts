/**
 * Inventory — FIFO POR ITEM em valor, com camadas congeladas (embarques fechados + abertura).
 * Régua: COGS de material por item e por mês do GL. Frete liberado = Σ consumido × absorção
 * da camada. Invariante: zerou o material do item, zerou o frete dele (frete em estoque é
 * SEMPRE saldo × absorção). Frete que chegou depois do fechamento (lateAdjustment) não mexe
 * na camada: vai inteiro ao COGS do mês em que entrou.
 */

import { prisma } from "@/lib/db";
import type { ClosedData } from "./shipments";
import { loadGlData, balanceAt, type GlData, type GlSettings } from "./gl";

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export type Layer = {
  shipmentId: string;
  shipmentName: string;
  isOpening: boolean;
  month: string; // mês de entrada (deliveredAt)
  itemId: string | null;
  itemName: string; // nome do item no QBO (p/ casar com o GL) ou nome da invoice se não mapeado
  glNames: string[];
  mat: number; // valor de fábrica que entrou
  left: number; // saldo
  abs: number; // absorção da camada p/ este item (alloc/amount)
  unitCost: number;
};

export type MonthRow = {
  month: string;
  matOut: number; // COGS material do GL (todos os itens)
  matOutMatched: number; // parte casada com camadas
  suggested: number; // frete a apropriar (FIFO) + ajustes tardios
  lateAdj: number;
  posted: number; // JE lançada no GL
  diff: number;
  shouldFreightStock: number; // Σ saldo × abs ao fim do mês
  glFreightStock: number | null;
  shouldMatStock: number; // Σ saldos das camadas
  glMatStock: number | null;
  // ajuste ACUMULADO (17/11): quanto a conta de frete no GL está acima do que deveria, já
  // descontando frete capitalizado no GL cujo embarque ainda não fechou aqui (em trânsito)
  // e somando frete de embarques fechados que o GL ainda não tem. JE do mês = catchUp.
  openInGl: number; // frete no GL sem camada aqui (embarque aberto / invoice não cadastrada)
  closedNotInGl: number; // frete de embarques fechados que não está no GL
  catchUp: number | null; // glFreightStock − (shouldFreightStock + openInGl − closedNotInGl); null sem GL
  closing: { freightOut: number; jeBookedAt: Date | null; jeBookedAmount: number | null; merchEndSource: string } | null;
  noLayer: Record<string, number>; // glName → COGS sem camada
  detail: { itemName: string; layer: string; take: number; abs: number; freight: number }[];
};

export type FifoResult = {
  layers: Layer[]; // estado FINAL (após o último mês)
  rows: MonthRow[];
  unmappedGlNames: Record<string, number>; // nome do GL sem item (COGS acumulado)
  gl: GlData;
};

/** Camadas a partir dos embarques fechados (+ abertura), uma por item. */
export async function loadLayers(companyId: string): Promise<Layer[]> {
  const [ships, items] = await Promise.all([
    prisma.inventoryShipment.findMany({ where: { companyId, closedAt: { not: null } }, select: { id: true, name: true, key: true, containers: true, deliveredAt: true, isOpening: true, closedData: true } }),
    prisma.inventoryItem.findMany({ where: { companyId }, select: { id: true, name: true, glNames: true } }),
  ]);
  const byId = new Map(items.map((i) => [i.id, i]));
  const L: Layer[] = [];
  for (const s of ships) {
    const d = s.closedData as unknown as ClosedData | null;
    if (!d || !s.deliveredAt) continue;
    const month = s.deliveredAt.toISOString().slice(0, 7);
    const name = s.name ?? (s.containers.length ? s.containers.join(" + ") : s.key);
    for (const it of d.items) {
      const item = it.itemId ? byId.get(it.itemId) : undefined;
      L.push({
        shipmentId: s.id,
        shipmentName: s.isOpening ? "Abertura" : name,
        isOpening: s.isOpening,
        month,
        itemId: it.itemId,
        itemName: item?.name ?? it.name,
        glNames: item ? [item.name, ...item.glNames] : [it.name],
        mat: it.amount,
        left: it.amount,
        abs: it.amount ? it.alloc / it.amount : 0,
        unitCost: it.unitCost,
      });
    }
  }
  L.sort((a, b) => a.month.localeCompare(b.month) || Number(b.isOpening) - Number(a.isOpening));
  return L;
}

/** Replay mês a mês desde o primeiro mês com camada ou movimento até `upTo` (inclusive). */
export async function runFifo(companyId: string, s: GlSettings, upTo?: string): Promise<FifoResult> {
  const [layers, gl, closings] = await Promise.all([
    loadLayers(companyId),
    loadGlData(companyId, s),
    prisma.inventoryClosing.findMany({ where: { companyId }, select: { month: true, freightOut: true, jeBookedAt: true, jeBookedAmount: true, merchEndSource: true } }),
  ]);
  const closingBy = new Map(closings.map((c) => [c.month, c]));
  // frete tardio: invoices FREIGHT lateAdjustment → mês da data da invoice
  const late = await prisma.inventoryInvoice.findMany({ where: { companyId, kind: "FREIGHT", lateAdjustment: true }, select: { date: true, total: true } });
  // frete das invoices cadastradas (p/ o acumulado): nº, data, total, mês da camada se o embarque fechou
  const frInv = await prisma.inventoryInvoice.findMany({ where: { companyId, kind: "FREIGHT" }, select: { no: true, date: true, total: true, shipment: { select: { closedAt: true, deliveredAt: true } } } });
  const closedMonthByNo = new Map<string, string>();
  for (const i of frInv) if (i.shipment?.closedAt && i.shipment.deliveredAt) closedMonthByNo.set(i.no, i.shipment.deliveredAt.toISOString().slice(0, 7));
  const frBills = gl.vendorBills.filter((b) => b.account === s.glFreightAccount && b.num).map((b) => ({ num: b.num as string, month: b.date.toISOString().slice(0, 7), amount: b.amount }));
  const billNums = new Set(frBills.map((b) => b.num));
  const coverageMonth = gl.coverageUntil ? gl.coverageUntil.toISOString().slice(0, 7) : null;
  const lateByMonth: Record<string, number> = {};
  for (const l of late) {
    const m = l.date.toISOString().slice(0, 7);
    lateByMonth[m] = r2((lateByMonth[m] ?? 0) + n(l.total));
  }
  // índice glName → camadas do item (ordem FIFO)
  const byName = new Map<string, Layer[]>();
  for (const L of layers) for (const g of L.glNames) (byName.get(g) ?? byName.set(g, []).get(g)!).push(L);

  const first = [...new Set([...layers.map((l) => l.month), ...gl.months])].sort()[0];
  const lastGl = gl.months[gl.months.length - 1] ?? first;
  const end = upTo ?? [lastGl, ...Object.keys(lateByMonth)].sort().slice(-1)[0] ?? first;
  const rows: MonthRow[] = [];
  const unmapped: Record<string, number> = {};
  if (!first) return { layers, rows, unmappedGlNames: unmapped, gl };
  let cur = first;
  const nextMonth = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    const d = new Date(Date.UTC(y, mo, 1));
    return d.toISOString().slice(0, 7);
  };
  while (cur <= end) {
    const cogs = gl.cogsByMonth[cur] ?? {};
    let matOut = 0;
    let matched = 0;
    let fr = 0;
    const noLayer: Record<string, number> = {};
    const detail: MonthRow["detail"] = [];
    for (const [glName, v] of Object.entries(cogs)) {
      matOut += v;
      let need = v;
      const ls = (byName.get(glName) ?? []).filter((L) => L.month <= cur);
      for (const L of ls) {
        if (need <= 0.004) break;
        if (L.left <= 0.004) continue;
        let take = Math.min(L.left, need);
        if (L.left - take < 0.01) take = L.left; // não deixa migalha
        L.left = r2(L.left - take);
        need -= take;
        matched += take;
        fr += take * L.abs;
        detail.push({ itemName: L.itemName, layer: L.shipmentName, take: r2(take), abs: L.abs, freight: r2(take * L.abs) });
      }
      if (need > 0.01) {
        noLayer[glName] = r2(need);
        unmapped[glName] = r2((unmapped[glName] ?? 0) + need);
      }
    }
    const lateAdj = lateByMonth[cur] ?? 0;
    const suggested = r2(fr + lateAdj);
    const posted = gl.freightPostedByMonth[cur] ?? 0;
    const eligible = layers.filter((L) => L.month <= cur);
    const c = closingBy.get(cur);
    // frete capitalizado no GL até `cur` cujo embarque não tinha camada em `cur`
    const openInGl = r2(frBills.filter((b) => b.month <= cur && !((closedMonthByNo.get(b.num) ?? "9999") <= cur)).reduce((x, b) => x + b.amount, 0));
    // frete de embarques fechados (camada ≤ cur) que o GL não tem, dentro da cobertura
    const closedNotInGl = r2(frInv.filter((i) => (closedMonthByNo.get(i.no) ?? "9999") <= cur && !billNums.has(i.no) && coverageMonth != null && i.date.toISOString().slice(0, 7) <= cur && i.date.toISOString().slice(0, 7) <= coverageMonth).reduce((x, i) => x + n(i.total), 0));
    const shouldFr = r2(eligible.reduce((s, L) => s + L.left * L.abs, 0));
    const glFr = balanceAt(gl.freightBalanceByMonth, cur);
    rows.push({
      month: cur,
      matOut: r2(matOut),
      matOutMatched: r2(matched),
      suggested,
      lateAdj: r2(lateAdj),
      posted: r2(posted),
      diff: r2(suggested - posted),
      shouldFreightStock: shouldFr,
      glFreightStock: glFr,
      openInGl,
      closedNotInGl,
      catchUp: glFr == null ? null : r2(glFr - (shouldFr + openInGl - closedNotInGl)),
      shouldMatStock: r2(eligible.reduce((s, L) => s + L.left, 0)),
      glMatStock: balanceAt(gl.inventoryBalanceByMonth, cur),
      closing: c ? { freightOut: n(c.freightOut), jeBookedAt: c.jeBookedAt, jeBookedAmount: c.jeBookedAmount == null ? null : n(c.jeBookedAmount), merchEndSource: c.merchEndSource } : null,
      noLayer,
      detail,
    });
    cur = nextMonth(cur);
  }
  return { layers, rows, unmappedGlNames: unmapped, gl };
}
