import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";

// Relatório de Faturamento × Lucro (substitui a planilha manual): a partir do GL (transações
// datadas) deriva, por MÊS, o faturamento (Income) e o lucro (Net = Income − Despesas). Monta os
// 4 blocos da planilha: mês×mês anterior, mês×mesmo mês ano passado, janela 12m YoY, e últimos 12m.
//
// Classificação de conta:
//  • Receita: contas do P&L (seção Income) OU nome claramente de receita (Sales/Revenue/Income).
//    Nomes de receita são seguros → o FATURAMENTO sai do GL mesmo sem P&L.
//  • Lucro (despesas): precisa de referência confiável, porque há contas impossíveis de adivinhar
//    pelo nome (ativos fixos com nome de equipamento, intercompany, contas numéricas). Então:
//      - se há BS importado → despesa = tudo que não é receita nem conta de balanço (complemento);
//      - senão, se há P&L → despesa = contas da seção Expenses do P&L;
//      - senão → lucro indisponível (mostra só faturamento e avisa para importar P&L/BS).

const MES_PT = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

function labelYm(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return `${MES_PT[m - 1]}/${String(y).slice(2)}`;
}
function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const base = y * 12 + (m - 1) + n;
  return `${Math.floor(base / 12)}-${String((base % 12) + 1).padStart(2, "0")}`;
}
const norm = (s: string) => s.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

// Nome claramente de receita (e não conta a receber/diferida).
const isIncomeName = (s: string) =>
  /\b(sales|revenue|income|receita|faturamento)\b/i.test(s) && !/receivable|payable|deferred|unearned|a\/r|a\/p/i.test(s);

export interface PeriodFig {
  label: string;
  income: number;
  net: number | null; // null = lucro não calculável (sem P&L/BS)
  margin: number | null;
}
export interface Block {
  key: string;
  title: string;
  current: PeriodFig;
  compare: PeriodFig | null;
  revVar: number | null;
  profitVar: number | null;
}
export interface Faturamento {
  companyId: string;
  companyName: string;
  currency: string;
  months: string[];
  refMonth: string;
  blocks: Block[];
  canComputeNet: boolean;
  coverage: {
    netBasis: "P&L+BS" | "P&L" | "BS" | "nenhum";
    hasPnl: boolean; // sem P&L a receita é só por heurística de nome (pode faltar conta)
    incomeAccounts: string[];
    classifiedPct: number;
    unknownAccounts: { account: string; amount: number }[];
    glSpan: { min: string | null; max: string | null };
    missingMonths: string[];
  };
}

export async function buildFaturamento(companyId: string, refMonthInput?: string): Promise<Faturamento | null> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { id: true, legalName: true, baseCurrency: true },
  });
  if (!company) return null;

  const [pnl, bs] = await Promise.all([
    prisma.qboImport.findFirst({ where: { companyId, reportKind: "PROFIT_AND_LOSS" }, orderBy: { createdAt: "desc" }, select: { id: true } }),
    prisma.qboImport.findFirst({ where: { companyId, reportKind: "BALANCE_SHEET" }, orderBy: { createdAt: "desc" }, select: { id: true } }),
  ]);
  const incomePnl = new Set<string>();
  const expensePnl = new Set<string>();
  const balance = new Set<string>();
  if (pnl) {
    const lines = await prisma.qboImportLine.findMany({ where: { importId: pnl.id, lineType: "ACCOUNT" }, select: { label: true, sectionPath: true } });
    for (const l of lines) {
      const sec = (l.sectionPath[0] ?? "").toLowerCase();
      if (/expense|cost of goods|cogs|custo/.test(sec)) expensePnl.add(norm(l.label));
      else if (/income|revenue|sales|receita|faturamento/.test(sec)) incomePnl.add(norm(l.label));
    }
  }
  if (bs) {
    const lines = await prisma.qboImportLine.findMany({ where: { importId: bs.id, lineType: "ACCOUNT" }, select: { label: true } });
    for (const l of lines) balance.add(norm(l.label));
  }

  // Como o lucro será apurado.
  const netBasis: Faturamento["coverage"]["netBasis"] = bs && pnl ? "P&L+BS" : bs ? "BS" : pnl ? "P&L" : "nenhum";
  // Com P&L, a despesa vem das contas da seção Expenses do P&L (preciso). O complemento (tudo que
  // não é receita nem balanço) só entra quando há BS mas não P&L — porque o QBO reusa nomes de
  // conta entre P&L e BS (ex.: equipamento que é ativo no BS e sub-conta de manutenção no P&L), e
  // o complemento jogaria a despesa de manutenção para o balanço, inflando o lucro.
  const mode: "complement" | "pnl" | "none" = pnl ? "pnl" : bs ? "complement" : "none";
  const canComputeNet = mode !== "none";

  const allMonths = await prisma.$queryRaw<{ ym: string }[]>(
    Prisma.sql`SELECT DISTINCT to_char(date, 'YYYY-MM') AS ym FROM "LedgerTxn" WHERE "companyId" = ${companyId} ORDER BY ym DESC`,
  );
  const months = allMonths.map((r) => r.ym);
  if (months.length === 0) {
    return {
      companyId, companyName: company.legalName, currency: company.baseCurrency, months: [], refMonth: refMonthInput ?? "",
      blocks: [], canComputeNet,
      coverage: { netBasis, hasPnl: !!pnl, incomeAccounts: [], classifiedPct: 0, unknownAccounts: [], glSpan: { min: null, max: null }, missingMonths: [] },
    };
  }
  const refMonth = refMonthInput && months.includes(refMonthInput) ? refMonthInput : months[0];
  const windowStart = addMonths(refMonth, -23);
  const startDate = `${windowStart}-01`;
  const refEndDate = `${addMonths(refMonth, 1)}-01`;

  const rows = await prisma.$queryRaw<{ ym: string; account: string; s: number }[]>(
    Prisma.sql`SELECT to_char(date, 'YYYY-MM') AS ym, account, SUM(amount)::float8 AS s
               FROM "LedgerTxn"
               WHERE "companyId" = ${companyId} AND date >= ${startDate}::date AND date < ${refEndDate}::date
               GROUP BY 1, 2`,
  );

  const monthly = new Map<string, { income: number; expense: number }>();
  const unknown = new Map<string, number>();
  let classifiedAbs = 0, unknownAbs = 0;
  const incomeUsed = new Set<string>();

  const classify = (account: string): "income" | "expense" | "balance" | "unknown" => {
    const n = norm(account);
    if (incomePnl.has(n) || isIncomeName(account)) return "income";
    if (mode === "complement") return balance.has(n) ? "balance" : "expense";
    // Híbrido (há P&L): despesa do P&L tem prioridade sobre o balanço (resolve nomes reusados
    // entre P&L e BS); o que não está em nenhum dos dois é assumido como despesa (P&L às vezes não
    // lista toda sub-conta que aparece no GL) — essas ficam listadas no painel para conferência.
    if (mode === "pnl") return expensePnl.has(n) ? "expense" : balance.has(n) ? "balance" : "expense";
    return "unknown"; // mode none → só receita
  };

  for (const r of rows) {
    const k = classify(r.account);
    const cell = monthly.get(r.ym) ?? { income: 0, expense: 0 };
    if (k === "income") { cell.income += r.s; classifiedAbs += Math.abs(r.s); incomeUsed.add(r.account); }
    else if (k === "expense") {
      cell.expense += r.s; classifiedAbs += Math.abs(r.s);
      // despesa "assumida" (não está no P&L nem no BS) → lista para conferência
      if (mode === "pnl" && !expensePnl.has(norm(r.account))) unknown.set(r.account, (unknown.get(r.account) ?? 0) + r.s);
    }
    else if (k === "balance") { /* fora do P&L */ }
    else { unknown.set(r.account, (unknown.get(r.account) ?? 0) + r.s); unknownAbs += Math.abs(r.s); }
    monthly.set(r.ym, cell);
  }

  // Calibra sinal (receita/despesa devem ficar positivas para Net = Income − Despesa).
  let incTot = 0, expTot = 0;
  for (const c of monthly.values()) { incTot += c.income; expTot += c.expense; }
  const incSign = incTot < 0 ? -1 : 1;
  const expSign = expTot < 0 ? -1 : 1;

  const figMonth = (ym: string): { income: number; net: number | null } => {
    const c = monthly.get(ym) ?? { income: 0, expense: 0 };
    const inc = c.income * incSign;
    return { income: inc, net: canComputeNet ? inc - c.expense * expSign : null };
  };
  const figTrailing = (endYm: string): { income: number; net: number | null } => {
    let income = 0, net = 0;
    for (let i = 0; i < 12; i++) { const f = figMonth(addMonths(endYm, -i)); income += f.income; net += f.net ?? 0; }
    return { income, net: canComputeNet ? net : null };
  };
  const fig = (label: string, v: { income: number; net: number | null }): PeriodFig => ({
    label, income: v.income, net: v.net, margin: v.net != null && v.income !== 0 ? v.net / v.income : null,
  });
  const variation = (cur: number, cmp: number): number | null => (cmp !== 0 ? cur / cmp - 1 : null);

  const prev = addMonths(refMonth, -1);
  const ly = addMonths(refMonth, -12);
  const trailEnd = refMonth, trailPrevEnd = addMonths(refMonth, -12);
  const mRef = figMonth(refMonth), mPrev = figMonth(prev), mLy = figMonth(ly);
  const tCur = figTrailing(trailEnd), tPrev = figTrailing(trailPrevEnd);
  const pv = (a: number | null, b: number | null) => (a != null && b != null ? variation(a, b) : null);

  const blocks: Block[] = [
    { key: "mom", title: "Mês × mês anterior", current: fig(labelYm(refMonth), mRef), compare: fig(labelYm(prev), mPrev), revVar: variation(mRef.income, mPrev.income), profitVar: pv(mRef.net, mPrev.net) },
    { key: "yoy", title: "Mesmo mês — ano a ano", current: fig(labelYm(refMonth), mRef), compare: fig(labelYm(ly), mLy), revVar: variation(mRef.income, mLy.income), profitVar: pv(mRef.net, mLy.net) },
    { key: "ttm-yoy", title: "Últimos 12 meses — ano a ano", current: fig(`${labelYm(addMonths(trailEnd, -11))}–${labelYm(trailEnd)}`, tCur), compare: fig(`${labelYm(addMonths(trailPrevEnd, -11))}–${labelYm(trailPrevEnd)}`, tPrev), revVar: variation(tCur.income, tPrev.income), profitVar: pv(tCur.net, tPrev.net) },
    { key: "ttm", title: "Últimos 12 meses", current: fig(`${labelYm(addMonths(trailEnd, -11))}–${labelYm(trailEnd)}`, tCur), compare: null, revVar: null, profitVar: null },
  ];

  const needed = new Set<string>([refMonth, prev, ly]);
  for (let i = 0; i < 12; i++) { needed.add(addMonths(trailEnd, -i)); needed.add(addMonths(trailPrevEnd, -i)); }
  const have = new Set(months);
  const missingMonths = [...needed].filter((m) => !have.has(m) && m <= refMonth && m >= (months[months.length - 1] ?? m)).sort();

  const unknownAccounts = [...unknown.entries()]
    .map(([account, amount]) => ({ account, amount }))
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 8);

  return {
    companyId, companyName: company.legalName, currency: company.baseCurrency, months, refMonth, blocks, canComputeNet,
    coverage: {
      netBasis,
      hasPnl: !!pnl,
      incomeAccounts: [...incomeUsed],
      classifiedPct: classifiedAbs + unknownAbs > 0 ? classifiedAbs / (classifiedAbs + unknownAbs) : 1,
      unknownAccounts,
      glSpan: { min: months[months.length - 1] ?? null, max: months[0] ?? null },
      missingMonths,
    },
  };
}
