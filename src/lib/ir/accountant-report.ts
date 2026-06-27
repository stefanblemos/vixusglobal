import { prisma } from "@/lib/db";
import { pnlTotals } from "@/lib/qbo/pnl";
import { effectiveFiguresOf } from "@/lib/ir/figures";

// Achados determinísticos para o report ao contador: o app encontra (números nossos),
// a IA só redige depois. Cruza o IR mais recente do ano com o P&L do QBO e a Schedule M-1.

type Figure = { key: string; label: string; value: number | null; line: string };

export interface ReportFinding {
  title: string;
  detail: string; // a pergunta com os números
  formRef?: string; // ex.: "1120 linha 17 / Schedule M-1 linha 5"
  amount?: number | null;
}

export interface ReportFindings {
  companyName: string;
  taxId: string | null;
  year: number;
  taxForm: string | null;
  preparer: string | null;
  currency: string;
  reconciles: string[]; // o que fecha
  questions: ReportFinding[]; // perguntas abertas
  hasData: boolean;
}

const near = (a: number, b: number, pct = 0.01) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * pct);
const money = (v: number | null | undefined, ccy: string) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: ccy, maximumFractionDigits: 0 }).format(v);

export async function buildReportFindings(companyId: string, year: number): Promise<ReportFindings> {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  const ir = await prisma.taxReturn.findFirst({
    where: { companyId, year },
    orderBy: { createdAt: "desc" },
  });
  const ccy = company?.baseCurrency ?? "USD";

  // P&L do QBO do mesmo ano.
  const pnlImport = await prisma.qboImport.findFirst({
    where: { companyId, reportKind: "PROFIT_AND_LOSS", periodLabel: { contains: String(year) } },
    orderBy: { createdAt: "desc" },
  });
  const pnlLines = pnlImport
    ? await prisma.qboImportLine.findMany({ where: { importId: pnlImport.id } })
    : [];
  const pnl = pnlTotals(pnlLines);

  const base: ReportFindings = {
    companyName: company?.legalName ?? "—",
    taxId: company?.taxId ?? null,
    year,
    taxForm: ir?.taxForm ?? null,
    preparer: ir?.preparer ?? null,
    currency: ccy,
    reconciles: [],
    questions: [],
    hasData: !!ir,
  };
  if (!ir) return base;

  const figures = (effectiveFiguresOf(ir) as Figure[]).filter(Boolean);
  const figVal = (k: string) => figures.find((f) => f.key === k)?.value ?? null;
  const irRevenue = figVal("GROSS_RECEIPTS");
  const irCogs = figVal("COST_OF_GOODS");
  const irDeductions = figVal("TOTAL_DEDUCTIONS");
  const irBookNet = figVal("NET_INCOME");
  const nonDeductible = figVal("NON_DEDUCTIBLE");
  const m1Items = figures.filter((f) => /^\s*m-1:/i.test(f.label));

  const reconciles: string[] = [];
  const questions: ReportFinding[] = [];

  if (irRevenue != null && pnl.revenue != null && near(pnl.revenue, irRevenue))
    reconciles.push(`Gross receipts tie out (${money(irRevenue, ccy)}).`);
  if (irCogs != null && pnl.cogs != null && near(pnl.cogs, irCogs))
    reconciles.push(`Cost of goods sold ties out (${money(irCogs, ccy)}).`);

  // Deduções: reconciliam pela M-1 (despesas QBO − add-backs não-dedutíveis ± reclassificações)?
  if (nonDeductible != null && pnl.expenses != null && irDeductions != null) {
    reconciles.push(
      `Deductions reconcile via Schedule M-1: book expenses ${money(pnl.expenses, ccy)} less non-deductible add-backs ${money(nonDeductible, ccy)} ≈ deductions per return ${money(irDeductions, ccy)}.`,
    );
    if (m1Items.length > 0) {
      reconciles.push(
        `Add-backs: ${m1Items.map((f) => `${f.label.replace(/^\s*m-1:\s*/i, "")} ${money(f.value, ccy)}`).join("; ")}.`,
      );
    }
  }

  // Pergunta 1 — restatement do lucro contábil (QBO vs "per books" da declaração).
  if (irBookNet != null && pnl.netIncome != null && !near(pnl.netIncome, irBookNet)) {
    const d = Math.round(pnl.netIncome - irBookNet);
    questions.push({
      title: "Book net income differs from QBO",
      detail: `The return's book net income (Schedule M-1, line 1) is ${money(irBookNet, ccy)}, but our QBO books show ${money(pnl.netIncome, ccy)} — a ${money(d, ccy)} difference. Please confirm the book adjustment/reclassification behind this so our records match the return.`,
      formRef: "Schedule M-1, line 1",
      amount: d,
    });
  }

  // Pergunta 2 — imposto estadual adicionado de volta (costuma ser dedutível no 1120 federal).
  const stateAddBack = m1Items.find((f) => /state\b.*tax|imposto\s+estadual|florida/i.test(f.label));
  if (stateAddBack?.value) {
    questions.push({
      title: "State income tax added back",
      detail: `State income tax of ${money(stateAddBack.value, ccy)} was added back as non-deductible (Schedule M-1, line 5). On the federal Form 1120 state income/franchise tax is generally deductible (line 17, Taxes and licenses). Is this an accrual-timing add-back (current-year accrual deducted on line 17, prior-year payment reversed), or was a deduction missed? (~${money(Math.round(stateAddBack.value * 0.21), ccy)} of federal tax at 21%.)`,
      formRef: "1120 line 17 / Schedule M-1 line 5",
      amount: stateAddBack.value,
    });
  }

  // Pergunta 3 — seguro de vida de diretores adicionado de volta (confirmar beneficiário).
  const lifeIns = m1Items.find((f) => /life\s*insurance|seguro\s*de\s*vida/i.test(f.label));
  if (lifeIns?.value) {
    questions.push({
      title: "Officers' life insurance",
      detail: `Officers' life insurance of ${money(lifeIns.value, ccy)} was added back. Confirm the corporation is the beneficiary (then non-deductible is correct).`,
      formRef: "Schedule M-1, line 5",
      amount: lifeIns.value,
    });
  }

  // Pergunta 4 — possível omissão de receita (livros faturam mais do que a declaração mostra).
  if (irRevenue != null && pnl.revenue != null && pnl.revenue - irRevenue > Math.max(1, irRevenue * 0.01)) {
    const d = Math.round(pnl.revenue - irRevenue);
    questions.push({
      title: "Revenue on books exceeds the return",
      detail: `Our QBO books show revenue of ${money(pnl.revenue, ccy)} vs ${money(irRevenue, ccy)} on the return — ${money(d, ccy)} more. Please confirm where this is reported (or whether it was omitted).`,
      formRef: "1120 line 1a",
      amount: d,
    });
  }

  return { ...base, reconciles, questions };
}
