// CONTAS ESPECÍFICAS que o app precisa (padronização MÍNIMA). O usuário usa o plano NATIVO do QBO;
// só estas poucas contas precisam ser criadas/padronizadas — porque o nome ou a separação muda o
// cálculo do imposto. Todo o resto (Salaries, Rent, Office, etc.) fica no nativo do QBO, e o app lê
// pelos TOTAIS de seção (Total Income/COGS/Expenses/Net Income; Total Assets/Liabilities/Equity).
// Sub-contas (contas filhas) de controle interno PODEM ficar — o app soma as folhas e herda o
// conceito do pai (ver taxAddBacksFromPnl). Contas numeradas por empresa (bancos, "0417 (Office)")
// são reais e distintas — não unificar.

export type M1Concept =
  | "federal_tax"
  | "state_principal"
  | "state_penalty"
  | "state_interest"
  | "meals_50"
  | "entertainment"
  | "penalties"
  | "officer_life";

export type SpecAction = "criar" | "padronizar" | "separar";

export interface AccountSpec {
  name: string; // nome padronizado EXATO a usar no QBO
  action: SpecAction; // criar (nova) · padronizar (unificar grafias) · separar (quebrar conta juntada)
  section: string;
  qboType: string; // Account Type do QBO
  qboDetail: string; // Detail Type do QBO
  m1?: M1Concept; // tratamento no Schedule M-1
  today: string; // o que existe HOJE (bagunça a corrigir)
  note?: string;
}

// As contas que MUDAM o cálculo (add-back / imposto). Só estas.
export const ACCOUNT_SPECS: AccountSpec[] = [
  {
    name: "State Income Tax – Principal",
    action: "separar", section: "Income tax", qboType: "Expenses", qboDetail: "Taxes Paid", m1: "state_principal",
    today: "“State Taxes” — one single bucket (5 companies)",
    note: "sub-account inside “Taxes paid”. Principal only — deductible federally, add-back in FL.",
  },
  {
    name: "State Income Tax – Penalty",
    action: "criar", section: "Income tax", qboType: "Expenses", qboDetail: "Taxes Paid", m1: "state_penalty",
    today: "today it disappears inside “State Taxes”",
    note: "penalty only — non-deductible.",
  },
  {
    name: "State Income Tax – Interest",
    action: "criar", section: "Income tax", qboType: "Expenses", qboDetail: "Interest Paid", m1: "state_interest",
    today: "today it disappears inside “State Taxes”",
    note: "interest only — deductible (stays out of the add-back).",
  },
  {
    name: "Federal Income Tax",
    action: "padronizar", section: "Income tax", qboType: "Expenses", qboDetail: "Taxes Paid", m1: "federal_tax",
    today: "“Federal Taxes” (2 companies)",
    note: "federal income tax — never deductible (full add-back).",
  },
  {
    name: "Meals",
    action: "padronizar", section: "Expenses", qboType: "Expenses", qboDetail: "Travel Meals", m1: "meals_50",
    today: "10 names: “Meals with clients”, “Team meals”, “Client Meals”, “Meals – Per Diem”, “Travel meal”…",
    note: "50% deductible. Your internal control sub-accounts CAN stay under this one — the app sums the leaves and inherits from the parent.",
  },
  {
    name: "Entertainment",
    action: "separar", section: "Expenses", qboType: "Expenses", qboDetail: "Entertainment", m1: "entertainment",
    today: "“Meals & Entertainment” together (14 companies)",
    note: "100% NON-deductible (TCJA). Must be a SEPARATE account from Meals — otherwise the app treats everything as 50%.",
  },
  {
    name: "Depreciation",
    action: "padronizar", section: "Expenses", qboType: "Expenses", qboDetail: "Depreciation",
    today: "4 spellings incl. the typo “Depreciation Espenses”",
    note: "the app compares against MACRS; a single name avoids noise.",
  },
  {
    name: "Officer Life Insurance",
    action: "padronizar", section: "Expenses", qboType: "Expenses", qboDetail: "Insurance", m1: "officer_life",
    today: "“Officers' life insurance” / “Partner Life Insurance”",
    note: "non-deductible when the company is the beneficiary.",
  },
  {
    name: "Penalties & Fines",
    action: "padronizar", section: "Expenses", qboType: "Expenses", qboDetail: "Other Miscellaneous Service Cost", m1: "penalties",
    today: "“Fines” / “Tax Fines & Penalties” / “Vehicle fines & penalties”",
    note: "non-deductible.",
  },
];

// Intercompany: não é “criar conta nova” e sim NOMEAR a coligada de forma consistente. O app casa os
// dois lados por nome (conciliação/consolidação) — se o casing divergir, não fecha.
export const INTERCOMPANY_NOTE = {
  problem: "“Vixus Investment Partners LLC” vs “VixUS Investment Partners LLC” (divergent casing).",
  rule: "In a loan/investment account with a group company's name, ALWAYS use the exact legal name, identical across all companies. Then reconciliation and consolidation match the two sides on their own.",
};

export const M1_LABEL: Record<M1Concept, string> = {
  federal_tax: "federal income tax — non-deductible",
  state_principal: "state principal — deductible fed / add-back FL",
  state_penalty: "state penalty — non-deductible",
  state_interest: "state interest — deductible",
  meals_50: "50% deductible",
  entertainment: "100% non-deductible",
  penalties: "non-deductible",
  officer_life: "non-deductible",
};
