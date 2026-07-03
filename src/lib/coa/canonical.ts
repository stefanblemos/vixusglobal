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
    action: "separar", section: "Imposto de renda", qboType: "Expenses", qboDetail: "Taxes Paid", m1: "state_principal",
    today: "“State Taxes” — um balde só (5 empresas)",
    note: "sub-conta dentro de “Taxes paid”. Só o principal — dedutível no federal, add-back em FL.",
  },
  {
    name: "State Income Tax – Penalty",
    action: "criar", section: "Imposto de renda", qboType: "Expenses", qboDetail: "Taxes Paid", m1: "state_penalty",
    today: "hoje some dentro de “State Taxes”",
    note: "só a multa — não dedutível.",
  },
  {
    name: "State Income Tax – Interest",
    action: "criar", section: "Imposto de renda", qboType: "Expenses", qboDetail: "Interest Paid", m1: "state_interest",
    today: "hoje some dentro de “State Taxes”",
    note: "só os juros — dedutíveis (ficam de fora do add-back).",
  },
  {
    name: "Federal Income Tax",
    action: "padronizar", section: "Imposto de renda", qboType: "Expenses", qboDetail: "Taxes Paid", m1: "federal_tax",
    today: "“Federal Taxes” (2 empresas)",
    note: "IR federal — nunca dedutível (add-back integral).",
  },
  {
    name: "Meals",
    action: "padronizar", section: "Despesas", qboType: "Expenses", qboDetail: "Travel Meals", m1: "meals_50",
    today: "10 nomes: “Meals with clients”, “Team meals”, “Client Meals”, “Meals – Per Diem”, “Travel meal”…",
    note: "50% dedutível. Suas sub-contas de controle PODEM ficar debaixo desta — o app soma as folhas e herda pelo pai.",
  },
  {
    name: "Entertainment",
    action: "separar", section: "Despesas", qboType: "Expenses", qboDetail: "Entertainment", m1: "entertainment",
    today: "“Meals & Entertainment” juntos (14 empresas)",
    note: "100% NÃO dedutível (TCJA). Tem que ser conta SEPARADA de Meals — senão o app trata tudo como 50%.",
  },
  {
    name: "Depreciation",
    action: "padronizar", section: "Despesas", qboType: "Expenses", qboDetail: "Depreciation",
    today: "4 grafias incl. o typo “Depreciation Espenses”",
    note: "o app compara com o MACRS; um nome só evita ruído.",
  },
  {
    name: "Officer Life Insurance",
    action: "padronizar", section: "Despesas", qboType: "Expenses", qboDetail: "Insurance", m1: "officer_life",
    today: "“Officers' life insurance” / “Partner Life Insurance”",
    note: "não dedutível quando a empresa é beneficiária.",
  },
  {
    name: "Penalties & Fines",
    action: "padronizar", section: "Despesas", qboType: "Expenses", qboDetail: "Other Miscellaneous Service Cost", m1: "penalties",
    today: "“Fines” / “Tax Fines & Penalties” / “Vehicle fines & penalties”",
    note: "não dedutível.",
  },
];

// Intercompany: não é “criar conta nova” e sim NOMEAR a coligada de forma consistente. O app casa os
// dois lados por nome (conciliação/consolidação) — se o casing divergir, não fecha.
export const INTERCOMPANY_NOTE = {
  problem: "“Vixus Investment Partners LLC” vs “VixUS Investment Partners LLC” (casing divergente).",
  rule: "Em conta de empréstimo/investimento com nome de empresa do grupo, use SEMPRE o nome legal exato e igual em todas as empresas. Aí a conciliação e a consolidação casam os dois lados sozinhas.",
};

export const M1_LABEL: Record<M1Concept, string> = {
  federal_tax: "IR federal — não dedutível",
  state_principal: "estadual principal — dedutível fed / add-back FL",
  state_penalty: "multa estadual — não dedutível",
  state_interest: "juros estadual — dedutível",
  meals_50: "50% dedutível",
  entertainment: "100% não dedutível",
  penalties: "não dedutível",
  officer_life: "não dedutível",
};
