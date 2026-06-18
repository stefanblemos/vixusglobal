import { prisma } from "@/lib/db";

// Matriz de completude por empresa, para um ano: o que está NA BASE para fechar o período —
// IR, P&L, Balance Sheet, General Ledger e extrato bancário. Vermelho = falta.

export type Cell = { ok: boolean; detail?: string };
export type CompletenessRow = {
  companyId: string;
  companyName: string;
  existed: boolean; // já constituída no ano? (senão, N/A)
  ir: Cell;
  pnl: Cell;
  bs: Cell;
  gl: Cell;
  bank: Cell;
  complete: number; // 0..5
};

const yearOf = (s: string | null) => {
  const m = (s ?? "").match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : null;
};

export async function buildCompleteness(year: number): Promise<{
  rows: CompletenessRow[];
  years: number[];
}> {
  const [companies, returns, imports, banks] = await Promise.all([
    prisma.company.findMany({
      where: { relationship: "GROUP_MEMBER" },
      select: { id: true, legalName: true, formationDate: true, status: true },
      orderBy: { legalName: "asc" },
    }),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null } },
      select: { companyId: true, year: true },
    }),
    prisma.qboImport.findMany({
      where: { companyId: { not: null } },
      select: { companyId: true, reportKind: true, periodLabel: true },
    }),
    prisma.bankStatement.findMany({ select: { companyId: true, periodEnd: true } }),
  ]);

  // Anos com qualquer dado (p/ o seletor).
  const years = new Set<number>();
  for (const r of returns) if (r.year) years.add(r.year);
  for (const i of imports) {
    const y = yearOf(i.periodLabel);
    if (y) years.add(y);
  }

  const irSet = new Set(returns.filter((r) => r.year === year).map((r) => r.companyId));
  const kindSet = (kind: string) =>
    new Set(
      imports.filter((i) => i.reportKind === kind && yearOf(i.periodLabel) === year).map((i) => i.companyId),
    );
  const pnlSet = kindSet("PROFIT_AND_LOSS");
  const bsSet = kindSet("BALANCE_SHEET");
  const glSet = kindSet("GENERAL_LEDGER");
  const bankSet = new Set(
    banks.filter((b) => b.periodEnd && b.periodEnd.getUTCFullYear() === year).map((b) => b.companyId),
  );

  // Primeiro ano de cada empresa: data de abertura OU o ano mais antigo com dado (IR/QBO).
  // Se esse ano for DEPOIS do analisado, a empresa ainda não existia → N/A.
  const earliest = new Map<string, number>();
  const seed = (id: string | null, y: number | null) => {
    if (!id || !y) return;
    const cur = earliest.get(id);
    if (cur == null || y < cur) earliest.set(id, y);
  };
  for (const c of companies) seed(c.id, yearOf(c.formationDate));
  for (const r of returns) seed(r.companyId, r.year);
  for (const i of imports) seed(i.companyId, yearOf(i.periodLabel));

  const rows: CompletenessRow[] = companies.map((c) => {
    const first = earliest.get(c.id);
    const existed = first == null || first <= year;
    const ir = { ok: irSet.has(c.id) };
    const pnl = { ok: pnlSet.has(c.id) };
    const bs = { ok: bsSet.has(c.id) };
    const gl = { ok: glSet.has(c.id) };
    const bank = { ok: bankSet.has(c.id) };
    const complete = existed ? [ir, pnl, bs, gl, bank].filter((x) => x.ok).length : 0;
    return { companyId: c.id, companyName: c.legalName, existed, ir, pnl, bs, gl, bank, complete };
  });

  return { rows, years: [...years].sort((a, b) => b - a) };
}
