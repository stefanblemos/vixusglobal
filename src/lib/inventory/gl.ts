/**
 * Inventory — a régua do GL do QuickBooks (LedgerTxn já importado na plataforma):
 *  - COGS de material por item e por mês (linhas "Inventory Asset" × Invoice de venda);
 *  - receita por item (margem realizada);
 *  - abertura por item (Inventory Starting Value);
 *  - saldos das contas de estoque (material e frete) por mês;
 *  - JEs de frete→COGS já lançadas (conta Shipping and Handling);
 *  - bills do fornecedor no GL (conferência "só no QBO").
 * O GL não traz quantidade: tudo aqui é em VALOR.
 */

import { prisma } from "@/lib/db";

const n = (v: unknown) => Number(v ?? 0);
const r2 = (v: number) => Math.round(v * 100) / 100;

export type GlSettings = {
  glInventoryAccount: string;
  glFreightAccount: string;
  glCogsMaterialAccount: string;
  glCogsFreightAccount: string;
  vendorName: string;
};

/** 1ª linha da descrição = nome do item no QBO; na abertura tira o sufixo " - Opening inventory and value". */
export function glItemName(description: string | null | undefined): string {
  return (description ?? "")
    .split("\n")[0]
    .replace(/\s*-\s*Opening inventory.*$/i, "")
    .trim();
}

export type GlItemMonth = Record<string, Record<string, number>>; // month → glName → valor

export type GlData = {
  coverageUntil: Date | null; // último lançamento do GL
  cogsByMonth: GlItemMonth; // COGS de material por item/mês (positivo)
  revenueByName: Record<string, number>;
  cogsByName: Record<string, number>;
  openingByName: Record<string, { amount: number; date: Date; category: string | null; cleanName: string }>; // chave = nome CRU do GL
  inventoryBalanceByMonth: Record<string, number>; // saldo acumulado da conta de material no fim do mês
  freightBalanceByMonth: Record<string, number>; // idem conta de frete capitalizado
  freightPostedByMonth: Record<string, number>; // JEs frete→COGS lançadas (conta COGS frete)
  freightCapitalizedByMonth: Record<string, number>; // entradas (positivas) na conta de frete
  vendorBills: { num: string | null; date: Date; account: string; amount: number; description: string | null }[];
  months: string[]; // meses com movimento (ordenados)
};

export async function loadGlData(companyId: string, s: GlSettings): Promise<GlData> {
  const tx = await prisma.ledgerTxn.findMany({
    where: { companyId, OR: [{ account: { in: [s.glInventoryAccount, s.glFreightAccount, s.glCogsMaterialAccount, s.glCogsFreightAccount] } }, { rawName: { contains: s.vendorName.split(" ")[0], mode: "insensitive" } }] },
    select: { date: true, account: true, type: true, num: true, rawName: true, description: true, amount: true },
    orderBy: { date: "asc" },
  });
  const cov = await prisma.ledgerTxn.aggregate({ where: { companyId }, _max: { date: true } });
  const out: GlData = {
    coverageUntil: cov._max.date ?? null,
    cogsByMonth: {},
    revenueByName: {},
    cogsByName: {},
    openingByName: {},
    inventoryBalanceByMonth: {},
    freightBalanceByMonth: {},
    freightPostedByMonth: {},
    freightCapitalizedByMonth: {},
    vendorBills: [],
    months: [],
  };
  const invMove: Record<string, number> = {};
  const frMove: Record<string, number> = {};
  const monthSet = new Set<string>();
  // receita por item precisa da conta de vendas — buscamos à parte (nome varia)
  const sales = await prisma.ledgerTxn.findMany({
    where: { companyId, type: "Invoice", account: { contains: "Sales of Product", mode: "insensitive" } },
    select: { description: true, amount: true },
  });
  for (const t of sales) {
    const k = glItemName(t.description);
    out.revenueByName[k] = r2((out.revenueByName[k] ?? 0) + n(t.amount));
  }
  for (const t of tx) {
    const m = t.date.toISOString().slice(0, 7);
    const a = n(t.amount);
    monthSet.add(m);
    if (t.account === s.glInventoryAccount) {
      invMove[m] = (invMove[m] ?? 0) + a;
      if (t.type === "Invoice") {
        const k = glItemName(t.description);
        out.cogsByMonth[m] = out.cogsByMonth[m] ?? {};
        out.cogsByMonth[m][k] = r2((out.cogsByMonth[m][k] ?? 0) + -a);
        out.cogsByName[k] = r2((out.cogsByName[k] ?? 0) + -a);
      } else if (t.type === "Inventory Starting Value") {
        const k = glItemName(t.description);
        const cat = (t.description ?? "").split("\n")[0].match(/^([A-Za-z &]+?)(?=[A-Z]{2,4}-|Vinyl|Freestanding|Security|Glass|Spring|Hinge)/)?.[1]?.trim() ?? null;
        const prev = out.openingByName[k];
        out.openingByName[k] = { amount: r2((prev?.amount ?? 0) + a), date: prev?.date ?? t.date, category: prev?.category ?? cat, cleanName: k };
      }
    } else if (t.account === s.glFreightAccount) {
      frMove[m] = (frMove[m] ?? 0) + a;
      if (a > 0) out.freightCapitalizedByMonth[m] = r2((out.freightCapitalizedByMonth[m] ?? 0) + a);
    } else if (t.account === s.glCogsFreightAccount) {
      out.freightPostedByMonth[m] = r2((out.freightPostedByMonth[m] ?? 0) + a);
    }
    if (t.rawName && t.rawName.toLowerCase().includes(s.vendorName.split(" ")[0].toLowerCase()) && t.type === "Bill" && !/Accounts Payable/i.test(t.account))
      out.vendorBills.push({ num: t.num, date: t.date, account: t.account, amount: a, description: t.description });
  }
  // nome limpo da abertura: o nome de venda que é sufixo do nome cru (mais longo), senão tira a categoria colada
  const saleNames = [...new Set([...Object.keys(out.cogsByName), ...Object.keys(out.revenueByName)])].sort((a, b) => b.length - a.length);
  for (const [raw, v] of Object.entries(out.openingByName)) {
    const hit = saleNames.find((sn) => sn.length >= 4 && raw.endsWith(sn));
    if (hit) {
      v.cleanName = hit;
      v.category = raw.slice(0, raw.length - hit.length).replace(/[\s-]+$/, "") || v.category;
    } else {
      const m = raw.match(/^(.*?)((?:[A-Z]{3,4}\s?-\s?|Vinyl Floor - |Security Light|Glass |Spring |Hinge ).*)$/);
      if (m && m[1]) {
        v.cleanName = m[2].trim();
        v.category = m[1].trim();
      }
    }
  }
  out.months = [...monthSet].sort();
  let ib = 0;
  let fb = 0;
  for (const m of out.months) {
    ib += invMove[m] ?? 0;
    fb += frMove[m] ?? 0;
    out.inventoryBalanceByMonth[m] = r2(ib);
    out.freightBalanceByMonth[m] = r2(fb);
  }
  return out;
}

/** Saldo de uma série acumulada no último mês ≤ month. */
export function balanceAt(series: Record<string, number>, month: string): number | null {
  const ks = Object.keys(series).filter((k) => k <= month).sort();
  return ks.length ? series[ks[ks.length - 1]] : null;
}
