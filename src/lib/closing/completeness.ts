import { prisma } from "@/lib/db";

// Matriz de completude por empresa, para um ano: o que está NA BASE para fechar o período —
// IR, P&L, Balance Sheet, General Ledger e extrato bancário. Vermelho = falta.

export type Cell = { ok: boolean; detail?: string };
export type CompletenessRow = {
  companyId: string;
  companyName: string;
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

  const rows: CompletenessRow[] = companies
    // Só empresas que já existiam no ano (do ano de abertura em diante).
    .filter((c) => {
      const fy = yearOf(c.formationDate);
      return fy == null || fy <= year;
    })
    .map((c) => {
      const ir = { ok: irSet.has(c.id) };
      const pnl = { ok: pnlSet.has(c.id) };
      const bs = { ok: bsSet.has(c.id) };
      const gl = { ok: glSet.has(c.id) };
      const bank = { ok: bankSet.has(c.id) };
      const complete = [ir, pnl, bs, gl, bank].filter((x) => x.ok).length;
      return { companyId: c.id, companyName: c.legalName, ir, pnl, bs, gl, bank, complete };
    });

  return { rows, years: [...years].sort((a, b) => b - a) };
}
