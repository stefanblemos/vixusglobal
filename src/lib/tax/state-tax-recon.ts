import { prisma } from "@/lib/db";
import { periodMonths } from "@/lib/qbo/period";

// TRAVA DE RECONCILIAÇÃO do estadual: a linha "State Taxes" do P&L de um ano Y é sempre estadual de
// anos ANTERIORES pago em Y (pode misturar vários anos). Só dá para confiar no add-back do preview
// (principal+multa voltam, juros fica) quando CADA dólar dessa linha está coberto por um pagamento
// datado no controle Florida (StateTaxFiling). Aqui comparamos, por empresa:
//   Σ(StateTaxFiling pagos no ano Y)  ==  linha "State Taxes" do P&L de Y.
// Se não fecha → falta cadastrar um pagamento (ou o P&L tem outra coisa) → NÃO confiar no add-back.

const yearOf = (s: string) => Number((s.match(/(20\d\d)/) ?? [])[0] ?? 0);
const num = (v: unknown) => Number((v as { toString(): string } | null)?.toString() ?? 0);
const r2 = (n: number) => Math.round(n * 100) / 100;

// Linha de imposto estadual de renda no P&L — mesmo critério do add-back do preview (exclui
// folha/vendas/imóvel).
function stateTaxLineFromPnl(lines: { lineType: string; label: string; value: unknown }[]): number {
  let sum = 0;
  for (const l of lines) {
    if (l.lineType !== "ACCOUNT" || l.value == null) continue;
    const n = l.label.toLowerCase();
    const payroll = /payroll|unemploy|\bfica\b|social security|medicare|withhold/.test(n);
    if (!payroll && /\bstate\b/.test(n) && /tax|income/.test(n) && !/sales|use tax|property|tangible/.test(n)) {
      sum += Math.abs(num(l.value));
    }
  }
  return r2(sum);
}

export interface StateReconFiling {
  taxYear: number;
  principal: number;
  penalty: number;
  interest: number;
  total: number;
}

export interface StateReconRow {
  companyId: string;
  name: string;
  pnlStateTaxes: number; // linha "State Taxes" do P&L do ano Y
  filingsPaid: number; // Σ dos StateTaxFiling pagos em Y
  filings: StateReconFiling[]; // detalhe por ano-competência
  addBack: number; // principal + multa (o que volta à base) desses filings
  deductibleInterest: number; // juros (fica) desses filings
  delta: number; // pnlStateTaxes − filingsPaid (≠0 = falta cadastrar / P&L tem outra coisa)
  reconciles: boolean; // fecha dentro da tolerância
  hasPnl: boolean; // existe P&L do ano
}

export interface StateTaxReconciliation {
  year: number;
  rows: StateReconRow[];
  unreconciled: number; // empresas que não fecham
}

export async function buildStateTaxReconciliation(year: number): Promise<StateTaxReconciliation> {
  const [companies, pnls, filings] = await Promise.all([
    prisma.company.findMany({ where: { jurisdiction: "US" }, select: { id: true, legalName: true } }),
    prisma.qboImport.findMany({
      where: { reportKind: "PROFIT_AND_LOSS", companyId: { not: null } },
      select: { companyId: true, periodLabel: true, lines: { where: { lineType: "ACCOUNT" }, select: { lineType: true, label: true, value: true } } },
    }),
    prisma.stateTaxFiling.findMany({
      select: { companyId: true, taxYear: true, principal: true, penalty: true, interest: true, paidDate: true },
    }),
  ]);
  const nameById = new Map(companies.map((c) => [c.id, c.legalName]));

  // P&L do ano Y por empresa: o de MAIOR cobertura (prefere Jan–Dez). A linha "State Taxes" dele.
  const bestPnl = new Map<string, { end: number; lines: typeof pnls[number]["lines"] }>();
  for (const p of pnls) {
    if (!p.companyId || yearOf(p.periodLabel) !== year) continue;
    const end = periodMonths(p.periodLabel)?.end ?? 12;
    const cur = bestPnl.get(p.companyId);
    if (!cur || end > cur.end) bestPnl.set(p.companyId, { end, lines: p.lines });
  }
  const pnlStateByCo = new Map<string, number>();
  const hasPnl = new Set<string>();
  for (const [id, v] of bestPnl) {
    hasPnl.add(id);
    pnlStateByCo.set(id, stateTaxLineFromPnl(v.lines));
  }

  // StateTaxFiling PAGOS no ano Y, agrupados por empresa/ano-competência.
  const filingsByCo = new Map<string, StateReconFiling[]>();
  for (const f of filings) {
    if (!f.paidDate || f.paidDate.getUTCFullYear() !== year) continue;
    const principal = num(f.principal), penalty = num(f.penalty), interest = num(f.interest);
    const row: StateReconFiling = { taxYear: f.taxYear, principal, penalty, interest, total: r2(principal + penalty + interest) };
    (filingsByCo.get(f.companyId) ?? filingsByCo.set(f.companyId, []).get(f.companyId)!).push(row);
  }

  const ids = new Set<string>([...pnlStateByCo.keys(), ...filingsByCo.keys()]);
  const rows: StateReconRow[] = [];
  for (const id of ids) {
    const pnlStateTaxes = r2(pnlStateByCo.get(id) ?? 0);
    const fs = (filingsByCo.get(id) ?? []).sort((a, b) => a.taxYear - b.taxYear);
    const filingsPaid = r2(fs.reduce((s, f) => s + f.total, 0));
    if (pnlStateTaxes <= 0.005 && filingsPaid <= 0.005) continue; // nada de estadual → fora
    const addBack = r2(fs.reduce((s, f) => s + f.principal + f.penalty, 0));
    const deductibleInterest = r2(fs.reduce((s, f) => s + f.interest, 0));
    const delta = r2(pnlStateTaxes - filingsPaid);
    const tol = Math.max(1, 0.01 * Math.abs(pnlStateTaxes || filingsPaid));
    rows.push({
      companyId: id,
      name: nameById.get(id) ?? "—",
      pnlStateTaxes,
      filingsPaid,
      filings: fs,
      addBack,
      deductibleInterest,
      delta,
      reconciles: Math.abs(delta) <= tol,
      hasPnl: hasPnl.has(id),
    });
  }
  rows.sort((a, b) => Number(a.reconciles) - Number(b.reconciles) || Math.abs(b.delta) - Math.abs(a.delta));
  return { year, rows, unreconciled: rows.filter((r) => !r.reconciles).length };
}
