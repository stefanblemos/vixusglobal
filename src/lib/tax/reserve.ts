import { prisma } from "@/lib/db";
import { pnlTotals } from "@/lib/qbo/pnl";
import { qboPeriodKey } from "@/lib/qbo/period";

export const GLOBAL_RATE_KEY = "GLOBAL";
const DEFAULT_RATE = 30;

export type ReserveRow = {
  companyId: string;
  name: string;
  currency: string;
  periodLabel: string | null;
  importId: string | null;
  profit: number | null; // net income do último P&L (já líquido das despesas, incl. depreciação se lançada)
  ratePct: number;
  hasOverride: boolean;
  reserve: number; // quanto separar (0 se prejuízo / sem P&L)
};

// Provisão de IR: por empresa, pega o P&L mais recente, aplica a alíquota de reserva
// (override da empresa ou default global) sobre o lucro → quanto guardar.
export async function buildTaxReserve(): Promise<{ rows: ReserveRow[]; globalRate: number }> {
  const [companies, pnls, rates] = await Promise.all([
    prisma.company.findMany({ select: { id: true, legalName: true, baseCurrency: true } }),
    prisma.qboImport.findMany({
      where: { reportKind: "PROFIT_AND_LOSS", companyId: { not: null } },
      select: { id: true, companyId: true, periodLabel: true },
    }),
    prisma.taxReserveRate.findMany(),
  ]);

  const globalRate = Number(
    rates.find((r) => r.companyId === GLOBAL_RATE_KEY)?.ratePct ?? DEFAULT_RATE,
  );
  const overrideByCompany = new Map(
    rates
      .filter((r) => r.companyId !== GLOBAL_RATE_KEY)
      .map((r) => [r.companyId, Number(r.ratePct)]),
  );

  // P&L mais recente por empresa (por PERÍODO, não por upload).
  const latest = new Map<string, { id: string; periodLabel: string }>();
  for (const p of pnls) {
    if (!p.companyId) continue;
    const cur = latest.get(p.companyId);
    if (!cur || qboPeriodKey(p.periodLabel) > qboPeriodKey(cur.periodLabel)) {
      latest.set(p.companyId, { id: p.id, periodLabel: p.periodLabel });
    }
  }

  const rows: ReserveRow[] = [];
  for (const c of companies) {
    const l = latest.get(c.id);
    if (!l) continue; // sem P&L → não entra no relatório
    const lines = await prisma.qboImportLine.findMany({
      where: { importId: l.id, lineType: "TOTAL" },
    });
    const profit = pnlTotals(lines).netIncome;
    const hasOverride = overrideByCompany.has(c.id);
    const ratePct = hasOverride ? overrideByCompany.get(c.id)! : globalRate;
    const reserve = profit != null && profit > 0 ? (profit * ratePct) / 100 : 0;
    rows.push({
      companyId: c.id,
      name: c.legalName,
      currency: c.baseCurrency,
      periodLabel: l.periodLabel,
      importId: l.id,
      profit,
      ratePct,
      hasOverride,
      reserve,
    });
  }

  rows.sort((a, b) => b.reserve - a.reserve);
  return { rows, globalRate };
}
