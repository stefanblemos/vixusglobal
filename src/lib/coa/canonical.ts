// PLANO DE CONTAS CANÔNICO do grupo Vixus — a FONTE ÚNICA para bookkeeping padronizado no QBO.
// Ideia: se TODA empresa usar exatamente estas contas, o app lê sem adivinhar, o add-back fica exato,
// a ponte livro→imposto (M-1) vira mecânica e a consolidação é soma limpa. Desenhado a partir das
// contas REAIS usadas hoje (holding + real estate/construção + serviços profissionais), com a
// separação fiscal que faltava — principal/multa/juros do estadual em contas SEPARADAS.
//
// `m1` = tratamento no Schedule M-1 (livro → imposto). null = despesa normal dedutível (sem ajuste).
// `intercompany` = elimina na consolidação do grupo. `qboType`/`qboDetail` = para gerar o import do QBO.

export type M1Concept =
  | "federal_tax" //   IR federal — NUNCA dedutível (add-back integral)
  | "state_principal" // estadual (principal) — dedutível no federal; add-back na apuração de FL
  | "state_penalty" //  multa do estadual — não dedutível (add-back)
  | "state_interest" // juros do estadual — dedutíveis (ficam de fora do add-back)
  | "meals_50" //       refeições — 50% dedutível (add-back de 50%)
  | "entertainment" //  entretenimento — 100% não dedutível (add-back integral, TCJA)
  | "penalties" //      multas/penalidades gerais — não dedutível
  | "officer_life" //   seguro de vida de sócio/diretor — não dedutível
  | "political"; //     contribuição política/lobby/clube — não dedutível

export type CoaConcept =
  | "cash" | "ar" | "inventory" | "wip" | "prepaid" | "deposits" | "fixed_cost" | "accum_dep"
  | "invest_sub" | "ic_asset"
  | "ap" | "credit_card" | "sales_tax" | "payroll_liab" | "tax_payable" | "note_payable" | "ic_liability"
  | "capital" | "contributions" | "distributions" | "retained" | "opening_balance"
  | "income" | "other_income" | "ic_income"
  | "cogs"
  | "expense" | "depreciation" | "loan_interest" | "charitable"
  | "tax_expense";

export type Statement = "BS" | "PL";

export interface CanonicalAccount {
  code: string; // numeração estável (1000 ativo, 2000 passivo, 3000 PL, 4000 receita, 5000 CMV, 6000 despesa, 7000 imposto)
  name: string; // nome EXATO a usar no QBO
  section: string; // agrupamento para exibição
  qboType: string; // "Account Type" no import do QBO
  qboDetail: string; // "Detail Type" no import do QBO
  statement: Statement;
  concept: CoaConcept;
  m1?: M1Concept; // ajuste M-1 se for conta de despesa com tratamento fiscal especial
  intercompany?: boolean; // elimina na consolidação
  note?: string;
}

export const CANONICAL_COA: CanonicalAccount[] = [
  // ── ATIVO ──
  { code: "1000", name: "Cash — Operating", section: "Ativo", qboType: "Bank", qboDetail: "Checking", statement: "BS", concept: "cash" },
  { code: "1010", name: "Cash — Tax Reserve", section: "Ativo", qboType: "Bank", qboDetail: "Savings", statement: "BS", concept: "cash", note: "conta-reserva do imposto (bate com o /reserve)" },
  { code: "1100", name: "Accounts Receivable", section: "Ativo", qboType: "Accounts receivable (A/R)", qboDetail: "Accounts Receivable (A/R)", statement: "BS", concept: "ar" },
  { code: "1200", name: "Intercompany Receivable", section: "Ativo", qboType: "Other Current Assets", qboDetail: "Other Current Assets", statement: "BS", concept: "ic_asset", intercompany: true, note: "empréstimo/valor a receber de empresa do grupo — elimina na consolidação" },
  { code: "1300", name: "Inventory & Materials", section: "Ativo", qboType: "Other Current Assets", qboDetail: "Inventory", statement: "BS", concept: "inventory" },
  { code: "1400", name: "Construction in Progress / Lots", section: "Ativo", qboType: "Other Current Assets", qboDetail: "Other Current Assets", statement: "BS", concept: "wip", note: "obra em andamento e lotes (real estate)" },
  { code: "1500", name: "Prepaid Expenses", section: "Ativo", qboType: "Other Current Assets", qboDetail: "Prepaid Expenses", statement: "BS", concept: "prepaid" },
  { code: "1600", name: "Security Deposits", section: "Ativo", qboType: "Other Assets", qboDetail: "Other Long-term Assets", statement: "BS", concept: "deposits" },
  { code: "1700", name: "Fixed Assets — Original Cost", section: "Ativo", qboType: "Fixed Assets", qboDetail: "Machinery & Equipment", statement: "BS", concept: "fixed_cost", note: "custo de aquisição (base da depreciação MACRS do app)" },
  { code: "1710", name: "Accumulated Depreciation", section: "Ativo", qboType: "Fixed Assets", qboDetail: "Accumulated Depreciation", statement: "BS", concept: "accum_dep", note: "contra-ativo (negativo)" },
  { code: "1800", name: "Investment in Subsidiaries", section: "Ativo", qboType: "Other Assets", qboDetail: "Other Long-term Assets", statement: "BS", concept: "invest_sub", intercompany: true, note: "participação em empresa do grupo — elimina na consolidação" },

  // ── PASSIVO ──
  { code: "2000", name: "Accounts Payable", section: "Passivo", qboType: "Accounts payable (A/P)", qboDetail: "Accounts Payable (A/P)", statement: "BS", concept: "ap" },
  { code: "2100", name: "Credit Cards", section: "Passivo", qboType: "Credit Card", qboDetail: "Credit Card", statement: "BS", concept: "credit_card" },
  { code: "2200", name: "Intercompany Payable", section: "Passivo", qboType: "Other Current Liabilities", qboDetail: "Other Current Liabilities", statement: "BS", concept: "ic_liability", intercompany: true, note: "dívida com empresa do grupo — elimina na consolidação" },
  { code: "2300", name: "Sales Tax Payable", section: "Passivo", qboType: "Other Current Liabilities", qboDetail: "Sales Tax Payable", statement: "BS", concept: "sales_tax" },
  { code: "2400", name: "Payroll Liabilities", section: "Passivo", qboType: "Other Current Liabilities", qboDetail: "Payroll Tax Payable", statement: "BS", concept: "payroll_liab" },
  { code: "2500", name: "State Income Tax Payable — Principal", section: "Passivo", qboType: "Other Current Liabilities", qboDetail: "Other Current Liabilities", statement: "BS", concept: "tax_payable", note: "SÓ o principal do estadual a pagar" },
  { code: "2510", name: "State Income Tax Payable — Penalty", section: "Passivo", qboType: "Other Current Liabilities", qboDetail: "Other Current Liabilities", statement: "BS", concept: "tax_payable", note: "SÓ a multa" },
  { code: "2520", name: "State Income Tax Payable — Interest", section: "Passivo", qboType: "Other Current Liabilities", qboDetail: "Other Current Liabilities", statement: "BS", concept: "tax_payable", note: "SÓ os juros" },
  { code: "2600", name: "Federal Income Tax Payable", section: "Passivo", qboType: "Other Current Liabilities", qboDetail: "Other Current Liabilities", statement: "BS", concept: "tax_payable" },
  { code: "2700", name: "Notes Payable — External", section: "Passivo", qboType: "Long Term Liabilities", qboDetail: "Notes Payable", statement: "BS", concept: "note_payable" },
  { code: "2800", name: "Notes Payable — Intercompany", section: "Passivo", qboType: "Long Term Liabilities", qboDetail: "Notes Payable", statement: "BS", concept: "ic_liability", intercompany: true, note: "empréstimo de empresa do grupo — casa com o motor de loans" },

  // ── PATRIMÔNIO ──
  { code: "3000", name: "Capital / Member Equity", section: "Patrimônio", qboType: "Equity", qboDetail: "Owner's Equity", statement: "BS", concept: "capital" },
  { code: "3100", name: "Capital Contributions", section: "Patrimônio", qboType: "Equity", qboDetail: "Owner's Equity", statement: "BS", concept: "contributions", note: "aportes dos sócios" },
  { code: "3200", name: "Distributions / Owner Draws", section: "Patrimônio", qboType: "Equity", qboDetail: "Owner's Equity", statement: "BS", concept: "distributions", note: "distribuições — reduz a capital account (base distribuível)" },
  { code: "3300", name: "Retained Earnings", section: "Patrimônio", qboType: "Equity", qboDetail: "Retained Earnings", statement: "BS", concept: "retained" },
  { code: "3900", name: "Opening Balance Equity", section: "Patrimônio", qboType: "Equity", qboDetail: "Opening Balance Equity", statement: "BS", concept: "opening_balance", note: "só housekeeping do QBO; deve zerar" },

  // ── RECEITA ──
  { code: "4000", name: "Construction & Product Sales", section: "Receita", qboType: "Income", qboDetail: "Sales of Product Income", statement: "PL", concept: "income" },
  { code: "4100", name: "Service Income", section: "Receita", qboType: "Income", qboDetail: "Service/Fee Income", statement: "PL", concept: "income" },
  { code: "4200", name: "Rental Income", section: "Receita", qboType: "Income", qboDetail: "Other Primary Income", statement: "PL", concept: "income" },
  { code: "4800", name: "Interest Income", section: "Receita", qboType: "Other Income", qboDetail: "Interest Earned", statement: "PL", concept: "other_income" },
  { code: "4900", name: "Other Income", section: "Receita", qboType: "Other Income", qboDetail: "Other Miscellaneous Income", statement: "PL", concept: "other_income" },
  { code: "4950", name: "Intercompany Income (K-1 / Distributions)", section: "Receita", qboType: "Other Income", qboDetail: "Other Miscellaneous Income", statement: "PL", concept: "ic_income", intercompany: true, note: "renda vinda de empresa do grupo — separada p/ não duplicar na consolidação" },

  // ── CUSTO (CMV / obra) ──
  { code: "5000", name: "Materials & Supplies — COGS", section: "Custo (COGS)", qboType: "Cost of Goods Sold", qboDetail: "Supplies & Materials - COGS", statement: "PL", concept: "cogs" },
  { code: "5100", name: "Subcontractors — COGS", section: "Custo (COGS)", qboType: "Cost of Goods Sold", qboDetail: "Cost of Labor - COGS", statement: "PL", concept: "cogs", note: "contractors/mão de obra de obra" },
  { code: "5200", name: "Closing Costs — COGS", section: "Custo (COGS)", qboType: "Cost of Goods Sold", qboDetail: "Other Costs of Services - COGS", statement: "PL", concept: "cogs" },
  { code: "5300", name: "Direct Labor — COGS", section: "Custo (COGS)", qboType: "Cost of Goods Sold", qboDetail: "Cost of Labor - COGS", statement: "PL", concept: "cogs" },

  // ── DESPESAS OPERACIONAIS ──
  { code: "6000", name: "Salaries & Wages", section: "Despesas", qboType: "Expenses", qboDetail: "Payroll Expenses", statement: "PL", concept: "expense" },
  { code: "6010", name: "Payroll Taxes — Employer", section: "Despesas", qboType: "Expenses", qboDetail: "Payroll Expenses", statement: "PL", concept: "expense", note: "FICA/FUTA/SUTA do empregador — dedutível (NÃO é IR)" },
  { code: "6100", name: "Legal & Professional Fees", section: "Despesas", qboType: "Expenses", qboDetail: "Legal & Professional Fees", statement: "PL", concept: "expense" },
  { code: "6110", name: "Accounting Fees", section: "Despesas", qboType: "Expenses", qboDetail: "Legal & Professional Fees", statement: "PL", concept: "expense" },
  { code: "6200", name: "Office Supplies", section: "Despesas", qboType: "Expenses", qboDetail: "Office/General Administrative Expenses", statement: "PL", concept: "expense" },
  { code: "6210", name: "Software & Subscriptions", section: "Despesas", qboType: "Expenses", qboDetail: "Office/General Administrative Expenses", statement: "PL", concept: "expense" },
  { code: "6300", name: "Rent", section: "Despesas", qboType: "Expenses", qboDetail: "Rent or Lease of Buildings", statement: "PL", concept: "expense" },
  { code: "6310", name: "Utilities", section: "Despesas", qboType: "Expenses", qboDetail: "Utilities", statement: "PL", concept: "expense" },
  { code: "6400", name: "Insurance — General", section: "Despesas", qboType: "Expenses", qboDetail: "Insurance", statement: "PL", concept: "expense" },
  { code: "6410", name: "Officer Life Insurance", section: "Despesas", qboType: "Expenses", qboDetail: "Insurance", statement: "PL", concept: "expense", m1: "officer_life", note: "NÃO dedutível quando a empresa é beneficiária" },
  { code: "6500", name: "Vehicle & Fuel", section: "Despesas", qboType: "Expenses", qboDetail: "Auto", statement: "PL", concept: "expense" },
  { code: "6600", name: "Travel", section: "Despesas", qboType: "Expenses", qboDetail: "Travel", statement: "PL", concept: "expense" },
  { code: "6610", name: "Meals", section: "Despesas", qboType: "Expenses", qboDetail: "Travel Meals", statement: "PL", concept: "expense", m1: "meals_50", note: "50% dedutível" },
  { code: "6620", name: "Entertainment", section: "Despesas", qboType: "Expenses", qboDetail: "Entertainment", statement: "PL", concept: "expense", m1: "entertainment", note: "100% NÃO dedutível (TCJA) — conta SEPARADA de Meals de propósito" },
  { code: "6700", name: "Dues & Subscriptions", section: "Despesas", qboType: "Expenses", qboDetail: "Office/General Administrative Expenses", statement: "PL", concept: "expense" },
  { code: "6710", name: "Bank Fees & Charges", section: "Despesas", qboType: "Expenses", qboDetail: "Bank Charges", statement: "PL", concept: "expense" },
  { code: "6720", name: "Property Taxes", section: "Despesas", qboType: "Expenses", qboDetail: "Taxes Paid", statement: "PL", concept: "expense", note: "imposto sobre imóvel — dedutível (NÃO é IR)" },
  { code: "6730", name: "Business Loan Interest", section: "Despesas", qboType: "Expenses", qboDetail: "Interest Paid", statement: "PL", concept: "loan_interest", note: "dedutível" },
  { code: "6740", name: "Penalties & Fines", section: "Despesas", qboType: "Expenses", qboDetail: "Other Miscellaneous Service Cost", statement: "PL", concept: "expense", m1: "penalties", note: "não dedutível" },
  { code: "6750", name: "Political & Lobbying", section: "Despesas", qboType: "Expenses", qboDetail: "Other Miscellaneous Service Cost", statement: "PL", concept: "expense", m1: "political", note: "não dedutível" },
  { code: "6800", name: "Charitable Contributions", section: "Despesas", qboType: "Expenses", qboDetail: "Charitable Contributions", statement: "PL", concept: "charitable", note: "limite de 10% p/ C-corp — tratado à parte" },
  { code: "6900", name: "Depreciation Expense", section: "Despesas", qboType: "Expenses", qboDetail: "Depreciation", statement: "PL", concept: "depreciation", note: "livro; o app compara com MACRS" },

  // ── IMPOSTO DE RENDA (a separação-chave) ──
  { code: "7000", name: "Federal Income Tax Expense", section: "Imposto de renda", qboType: "Expenses", qboDetail: "Taxes Paid", statement: "PL", concept: "tax_expense", m1: "federal_tax", note: "IR federal — nunca dedutível" },
  { code: "7100", name: "State Income Tax — Principal", section: "Imposto de renda", qboType: "Expenses", qboDetail: "Taxes Paid", statement: "PL", concept: "tax_expense", m1: "state_principal", note: "SÓ o principal — dedutível no federal, add-back em FL" },
  { code: "7110", name: "State Income Tax — Penalty", section: "Imposto de renda", qboType: "Expenses", qboDetail: "Taxes Paid", statement: "PL", concept: "tax_expense", m1: "state_penalty", note: "SÓ a multa — não dedutível" },
  { code: "7120", name: "State Income Tax — Interest", section: "Imposto de renda", qboType: "Expenses", qboDetail: "Interest Paid", statement: "PL", concept: "tax_expense", m1: "state_interest", note: "SÓ os juros — dedutíveis" },
];

export const COA_SECTIONS = [
  "Ativo", "Passivo", "Patrimônio", "Receita", "Custo (COGS)", "Despesas", "Imposto de renda",
] as const;

export function coaBySection(): { section: string; accounts: CanonicalAccount[] }[] {
  return COA_SECTIONS.map((section) => ({
    section,
    accounts: CANONICAL_COA.filter((a) => a.section === section),
  }));
}
