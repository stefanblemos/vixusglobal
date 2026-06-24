import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

// Relatório de Faturamento × Lucro (substitui a planilha manual): a partir do GL (transações
// datadas) deriva, por MÊS, o faturamento (Income) e o lucro (Net = Income − Despesas). As contas
// são classificadas (income vs despesa vs balanço) pela estrutura do P&L/BS já importado. Monta os
// 4 blocos da planilha: mês×mês anterior, mês×mesmo mês ano passado, janela 12m YoY, e últimos 12m.

const MES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

// "2026-05" → "Mai/26"
function labelYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MES_PT[m - 1]}/${String(y).slice(2)}`;
}
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const base = (y * 12 + (m - 1)) + n;
  const ny = Math.floor(base / 12);
  const nm = (base % 12) + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}
const norm = (s: string) => s.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

export interface PeriodFig {
  label: string;
  income: number;
  net: number;
  margin: number | null; // net / income
}
export interface Block {
  key: string;
  title: string;
  current: PeriodFig;
  compare: PeriodFig | null;
  revVar: number | null; // variação % do faturamento (current/compare − 1)
  profitVar: number | null; // variação % do lucro
}
export interface Faturamento {
  companyId: string;
  companyName: string;
  currency: string;
  months: string[]; // YYYY-MM disponíveis (do GL) para o seletor — desc
  refMonth: string;
  blocks: Block[];
  coverage: {
    hasPnl: boolean;
    incomeAccounts: string[];
    classifiedPct: number; // quanto do movimento do GL foi classificado (income+despesa)
    unknownAccounts: { account: string; amount: number }[];
    glSpan: { min: string | null; max: string | null };
    missingMonths: string[]; // meses pedidos pelos blocos sem dado no GL
  };
}

type MonthAgg = Map<string, { income: number; expense: number }>;

export async function buildFaturamento(companyId: string, refMonthInput?: string): Promise<Faturamento | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, legalName: true, baseCurrency: true },
  });
  if (!company) return null;

  // Classificação de conta a partir do último P&L (income/despesa) e do último BS (balanço).
  const [pnl, bs] = await Promise.all([
    prisma.qboImport.findFirst({
      where: { companyId, reportKind: "PROFIT_AND_LOSS" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
    prisma.qboImport.findFirst({
      where: { companyId, reportKind: "BALANCE_SHEET" },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    }),
  ]);
  const income = new Set<string>();
  const expense = new Set<string>();
  const balance = new Set<string>();
  if (pnl) {
    const lines = await prisma.qboImportLine.findMany({
      where: { importId: pnl.id, lineType: "ACCOUNT" },
      select: { label: true, sectionPath: true },
    });
    for (const l of lines) {
      const sec = (l.sectionPath[0] ?? "").toLowerCase();
      if (/expense|cost of goods|cogs|custo/.test(sec)) expense.add(norm(l.label));
      else if (/income|revenue|sales|receita|faturamento/.test(sec)) income.add(norm(l.label));
    }
  }
  if (bs) {
    const lines = await prisma.qboImportLine.findMany({
      where: { importId: bs.id, lineType: "ACCOUNT" },
      select: { label: true },
    });
    for (const l of lines) balance.add(norm(l.label));
  }

  // Meses disponíveis no GL (para o seletor) + janela necessária (até 24 meses atrás do ref).
  const allMonths = await prisma.$queryRaw<{ ym: string }[]>(
    Prisma.sql`SELECT DISTINCT to_char(date, 'YYYY-MM') AS ym FROM "LedgerTxn" WHERE "companyId" = ${companyId} ORDER BY ym DESC`,
  );
  const months = allMonths.map((r) => r.ym);
  if (months.length === 0) {
    return {
      companyId, companyName: company.legalName, currency: company.baseCurrency,
      months: [], refMonth: refMonthInput ?? "", blocks: [],
      coverage: { hasPnl: !!pnl, incomeAccounts: [], classifiedPct: 0, unknownAccounts: [], glSpan: { min: null, max: null }, missingMonths: [] },
    };
  }
  const refMonth = refMonthInput && months.includes(refMonthInput) ? refMonthInput : months[0];
  const windowStart = addMonths(refMonth, -23);
  const startDate = `${windowStart}-01`;
  const refEndDate = `${addMonths(refMonth, 1)}-01`; // exclusivo

  // Soma por mês × conta no intervalo (rápido no banco).
  const rows = await prisma.$queryRaw<{ ym: string; account: string; s: number }[]>(
    Prisma.sql`SELECT to_char(date, 'YYYY-MM') AS ym, account, SUM(amount)::float8 AS s
               FROM "LedgerTxn"
               WHERE "companyId" = ${companyId} AND date >= ${startDate}::date AND date < ${refEndDate}::date
               GROUP BY 1, 2`,
  );

  const monthly: MonthAgg = new Map();
  const unknown = new Map<string, number>();
  let classifiedAbs = 0;
  let unknownAbs = 0;
  const incomeUsed = new Set<string>();
  for (const r of rows) {
    const n = norm(r.account);
    const cell = monthly.get(r.ym) ?? { income: 0, expense: 0 };
    if (income.has(n)) {
      cell.income += r.s;
      classifiedAbs += Math.abs(r.s);
      incomeUsed.add(r.account);
    } else if (expense.has(n)) {
      cell.expense += r.s;
      classifiedAbs += Math.abs(r.s);
    } else if (balance.has(n)) {
      // conta de balanço — não entra no P&L
    } else {
      unknown.set(r.account, (unknown.get(r.account) ?? 0) + r.s);
      unknownAbs += Math.abs(r.s);
    }
    monthly.set(r.ym, cell);
  }

  // Calibra o sinal (alguns exports lançam receita como crédito negativo): se o total da janela
  // ficou negativo, inverte. Despesa idem (queremos positiva, para Net = Income − Despesa).
  let incTot = 0, expTot = 0;
  for (const c of monthly.values()) { incTot += c.income; expTot += c.expense; }
  const incSign = incTot < 0 ? -1 : 1;
  const expSign = expTot < 0 ? -1 : 1;

  const figMonth = (ym: string): { income: number; net: number } => {
    const c = monthly.get(ym) ?? { income: 0, expense: 0 };
    const inc = c.income * incSign;
    const exp = c.expense * expSign;
    return { income: inc, net: inc - exp };
  };
  const figTrailing = (endYm: string): { income: number; net: number } => {
    let income = 0, net = 0;
    for (let i = 0; i < 12; i++) {
      const f = figMonth(addMonths(endYm, -i));
      income += f.income;
      net += f.net;
    }
    return { income, net };
  };
  const fig = (label: string, v: { income: number; net: number }): PeriodFig => ({
    label, income: v.income, net: v.net, margin: v.income !== 0 ? v.net / v.income : null,
  });
  const variation = (cur: number, cmp: number): number | null => (cmp !== 0 ? cur / cmp - 1 : null);

  const prev = addMonths(refMonth, -1);
  const ly = addMonths(refMonth, -12);
  const trailEnd = refMonth;
  const trailPrevEnd = addMonths(refMonth, -12);
  const mRef = figMonth(refMonth), mPrev = figMonth(prev), mLy = figMonth(ly);
  const tCur = figTrailing(trailEnd), tPrev = figTrailing(trailPrevEnd);

  const blocks: Block[] = [
    {
      key: "mom",
      title: "Mês × mês anterior",
      current: fig(labelYm(refMonth), mRef),
      compare: fig(labelYm(prev), mPrev),
      revVar: variation(mRef.income, mPrev.income),
      profitVar: variation(mRef.net, mPrev.net),
    },
    {
      key: "yoy",
      title: "Mesmo mês — ano a ano",
      current: fig(labelYm(refMonth), mRef),
      compare: fig(labelYm(ly), mLy),
      revVar: variation(mRef.income, mLy.income),
      profitVar: variation(mRef.net, mLy.net),
    },
    {
      key: "ttm-yoy",
      title: "Últimos 12 meses — ano a ano",
      current: fig(`${labelYm(addMonths(trailEnd, -11))}–${labelYm(trailEnd)}`, tCur),
      compare: fig(`${labelYm(addMonths(trailPrevEnd, -11))}–${labelYm(trailPrevEnd)}`, tPrev),
      revVar: variation(tCur.income, tPrev.income),
      profitVar: variation(tCur.net, tPrev.net),
    },
    {
      key: "ttm",
      title: "Últimos 12 meses",
      current: fig(`${labelYm(addMonths(trailEnd, -11))}–${labelYm(trailEnd)}`, tCur),
      compare: null,
      revVar: null,
      profitVar: null,
    },
  ];

  // Meses pedidos pelos blocos que não têm dado no GL.
  const needed = new Set<string>([refMonth, prev, ly]);
  for (let i = 0; i < 12; i++) { needed.add(addMonths(trailEnd, -i)); needed.add(addMonths(trailPrevEnd, -i)); }
  const have = new Set(months);
  const missingMonths = [...needed].filter((m) => !have.has(m) && m <= refMonth).sort();

  const unknownAccounts = [...unknown.entries()]
    .map(([account, amount]) => ({ account, amount: amount * 1 }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 8);

  return {
    companyId,
    companyName: company.legalName,
    currency: company.baseCurrency,
    months,
    refMonth,
    blocks,
    coverage: {
      hasPnl: !!pnl,
      incomeAccounts: [...incomeUsed],
      classifiedPct: classifiedAbs + unknownAbs > 0 ? classifiedAbs / (classifiedAbs + unknownAbs) : 1,
      unknownAccounts,
      glSpan: { min: months[months.length - 1] ?? null, max: months[0] ?? null },
      missingMonths,
    },
  };
}
