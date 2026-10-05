import { prisma } from "@/lib/db";

/**
 * Extrato da casa (05/10/2026). Fonte única do capital próprio e dos custos reais da casa:
 * os campos PoolHouse.ownCapital / actualLotCost / actualBuildCost são CACHE da soma dos
 * lançamentos (recomputados aqui nos write-paths), como o status é cache dos fatos.
 *
 * O extrato que o usuário vê junta os lançamentos gravados (HouseCashEntry) com linhas
 * DERIVADAS de outras fontes: draws do banco (PoolLoanEntry DRAW) e o líquido da venda
 * (netReceived da ficha). Nada é duplicado.
 */

export const CASH_CATEGORIES = [
  ["EQUITY_IN", "Pool colocou capital próprio na casa", "in"],
  ["LOT", "Paguei o lote", "out"],
  ["CASH_TO_CLOSE", "Cash to close / taxa do banco", "out"],
  ["BUILD", "Paguei obra com capital próprio", "out"],
  ["BANK_FEE", "Taxa do banco (inspeção, draw fee…)", "out"],
  ["INTEREST", "Juros pagos pela casa", "out"],
  ["CARRYING", "Custo de carregamento (seguro, imposto, luz)", "out"],
  ["OTHER", "Outro custo", "out"],
  ["RETURN_TO_POOL", "Devolvi excedente ao caixa do pool", "in-reverse"],
] as const;

export type CashCategory = (typeof CASH_CATEGORIES)[number][0];

export const CATEGORY_LABEL: Record<string, string> = {
  OPENING: "Capital próprio (partida)",
  EQUITY_IN: "Capital próprio (partida)",
  LOT: "Lote",
  CASH_TO_CLOSE: "Cash to close / taxa do banco",
  BUILD: "Obra (capital próprio)",
  BANK_FEE: "Taxa do banco",
  INTEREST: "Juros",
  CARRYING: "Carregamento",
  OTHER: "Outro",
  RETURN_TO_POOL: "Excedente devolvido ao caixa do pool",
};

/** categoria do form → kind do lançamento */
export function kindForCategory(category: string): "EQUITY_IN" | "COST" | "RETURN_TO_POOL" {
  if (category === "EQUITY_IN") return "EQUITY_IN";
  if (category === "RETURN_TO_POOL") return "RETURN_TO_POOL";
  return "COST";
}

export type CashEntryLike = {
  kind: "EQUITY_IN" | "COST" | "RETURN_TO_POOL";
  category: string;
  amount: unknown;
};

const n = (v: unknown) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/** Somas do extrato gravado (sem as linhas derivadas). */
export function houseCashTotals(entries: CashEntryLike[]) {
  let equityIn = 0, returned = 0, lot = 0, build = 0, otherCosts = 0;
  for (const e of entries) {
    const a = n(e.amount);
    if (e.kind === "EQUITY_IN") equityIn += a;
    else if (e.kind === "RETURN_TO_POOL") returned += a;
    else if (e.category === "LOT") lot += a;
    else if (e.category === "BUILD") build += a;
    else otherCosts += a;
  }
  return {
    equityIn: r2(equityIn),
    returned: r2(returned),
    ownCapital: r2(equityIn - returned), // o que o pool deixou na casa (líquido)
    lot: r2(lot),
    build: r2(build),
    otherCosts: r2(otherCosts),
    hasLot: entries.some((e) => e.kind === "COST" && e.category === "LOT"),
    hasBuild: entries.some((e) => e.kind === "COST" && e.category === "BUILD"),
    hasEquity: entries.some((e) => e.kind === "EQUITY_IN" || e.kind === "RETURN_TO_POOL"),
  };
}

/** Recomputa e PERSISTE o cache (ownCapital / actualLotCost / actualBuildCost) da casa. */
export async function recomputeHouseCash(houseId: string): Promise<void> {
  const entries = await prisma.houseCashEntry.findMany({ where: { houseId } });
  const t = houseCashTotals(entries);
  await prisma.poolHouse.update({
    where: { id: houseId },
    data: {
      ownCapital: t.hasEquity ? t.ownCapital : null,
      actualLotCost: t.hasLot ? t.lot : null,
      actualBuildCost: t.hasBuild ? t.build : null,
    },
  });
}

export type LedgerRow = {
  id: string | null; // null = linha derivada (não apagável aqui)
  date: string | null; // ISO; null = abertura
  label: string;
  source: "POOL" | "BANK" | "SALE" | null;
  inAmount: number | null;
  outAmount: number | null;
  memo: string | null;
  derived: boolean;
};

/**
 * Extrato completo da casa: lançamentos gravados + draws (banco) + venda (líquido recebido).
 * Saldo = entrou − saiu: positivo = dinheiro que entrou e não foi gasto (custo não lançado
 * ou excedente a devolver ao pool).
 */
export function buildHouseLedger(args: {
  entries: Array<CashEntryLike & { id: string; date: Date; opening: boolean; memo: string | null }>;
  draws: Array<{ date: Date; amount: unknown; memo: string | null; pending: boolean }>;
  sale: { date: Date | null; netReceived: unknown | null };
}) {
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const rows: LedgerRow[] = [];
  for (const e of args.entries) {
    const a = n(e.amount);
    const isIn = e.kind === "EQUITY_IN";
    rows.push({
      id: e.id,
      date: e.opening ? null : iso(e.date),
      label: CATEGORY_LABEL[e.category] ?? e.category,
      source: isIn ? "POOL" : e.kind === "RETURN_TO_POOL" ? "POOL" : null,
      inAmount: isIn ? a : null,
      outAmount: isIn ? null : a,
      memo: e.memo,
      derived: false,
    });
  }
  for (const d of args.draws) {
    if (d.pending) continue;
    rows.push({
      id: null, date: iso(d.date), label: `Draw${d.memo ? ` · ${d.memo}` : ""}`, source: "BANK",
      inAmount: n(d.amount), outAmount: null, memo: null, derived: true,
    });
  }
  if (args.sale.netReceived != null && args.sale.date) {
    rows.push({
      id: null, date: iso(args.sale.date), label: "Venda · líquido recebido", source: "SALE",
      inAmount: n(args.sale.netReceived), outAmount: null, memo: null, derived: true,
    });
  }
  // abertura primeiro, depois por data
  rows.sort((a, b) => (a.date == null ? -1 : b.date == null ? 1 : a.date.localeCompare(b.date)));
  const totalIn = r2(rows.reduce((s, r) => s + (r.inAmount ?? 0), 0));
  const totalOut = r2(rows.reduce((s, r) => s + (r.outAmount ?? 0), 0));
  const saleIn = r2(rows.filter((r) => r.source === "SALE").reduce((s, r) => s + (r.inAmount ?? 0), 0));
  return {
    rows,
    totalIn,
    totalOut,
    // saldo parado na casa ANTES da venda (o que a venda devolve ao pool é à parte)
    balance: r2(totalIn - saleIn - totalOut),
    saleIn,
  };
}
