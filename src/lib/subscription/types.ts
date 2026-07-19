// Respostas do wizard de subscrição online (mock aprovado 19/07/2026).
// O mesmo shape vive em PoolSubscription.data (draft → congelado na assinatura)
// e em InvestorProfile.data (perfil reutilizável que pré-preenche a próxima).

// Gestora dos veículos VHP-* (confirmado pelo Stefan, 19/07) — vira campo por pool
// quando existirem pools com outra gestora.
export const MANAGER_NAME = "VIXUS INVESTMENT PARTNERS LLC";
export const POOL_COUNTY = "Orange";

export type UboRow = { name: string; pct: string; control: boolean };

export type WizardData = {
  units?: number;
  type?: "INDIVIDUAL" | "LLC" | "CORPORATION" | "PARTNERSHIP" | "TRUST" | "OTHER";
  legalName?: string;
  jurisdiction?: string;
  tin?: string;
  email?: string;
  phone?: string;
  address?: string;
  accreditation?: string[]; // chaves ACCREDITATION_KEYS marcadas
  ubo?: UboRow[];
  usPerson?: boolean;
  taxClassification?: string;
  sourceOfFunds?: string;
};

// Categorias 506(b)/Rule 501(a) — texto EXATO que entra no Part III do DOCX gerado.
// scope filtra as opções pelo tipo de investidor no wizard (PF × entidade).
export const ACCREDITATION_OPTIONS: { key: string; scope: "individual" | "entity" | "both"; en: string; pt: string }[] = [
  {
    key: "net_worth",
    scope: "individual",
    en: "Individual with net worth (alone or with spouse) exceeding US$1,000,000, excluding the primary residence",
    pt: "Meu patrimônio líquido (sozinho ou com cônjuge) passa de US$1 milhão, sem contar a residência principal",
  },
  {
    key: "income",
    scope: "individual",
    en: "Individual with income exceeding US$200,000 (or US$300,000 jointly) in each of the two most recent years, with the same expectation for the current year",
    pt: "Minha renda passou de US$200 mil (US$300 mil com o cônjuge) nos dois últimos anos, e deve se manter",
  },
  {
    key: "entity_assets",
    scope: "entity",
    en: "Entity with total assets exceeding US$5,000,000, not formed for the specific purpose of acquiring the Units",
    pt: "A empresa tem mais de US$5 milhões em ativos e não foi criada só para este investimento",
  },
  {
    key: "all_owners",
    scope: "entity",
    en: "Entity in which all equity owners are accredited investors",
    pt: "Todos os sócios da empresa são, individualmente, investidores credenciados (cada um atende a um critério de renda ou patrimônio acima)",
  },
  {
    key: "license",
    scope: "both",
    en: "Holder in good standing of a Series 7, 65 or 82 license",
    pt: "Sou portador de licença Series 7, 65 ou 82 em situação regular",
  },
  {
    key: "none",
    scope: "both",
    en: "None of the above",
    pt: "Nenhuma das anteriores / tenho dúvida",
  },
];

export const INVESTOR_TYPES: { key: NonNullable<WizardData["type"]>; en: string; pt: string }[] = [
  { key: "LLC", en: "Limited liability company (LLC)", pt: "Pessoa jurídica (LLC)" },
  { key: "INDIVIDUAL", en: "Individual", pt: "Pessoa física" },
  { key: "CORPORATION", en: "Corporation", pt: "Corporation" },
  { key: "PARTNERSHIP", en: "Partnership", pt: "Partnership" },
  { key: "TRUST", en: "Trust / IRA", pt: "Trust / IRA" },
  { key: "OTHER", en: "Other", pt: "Outro" },
];

// Campos mínimos para poder assinar (o wizard valida por passo; a action revalida).
export function missingForSignature(d: WizardData): string[] {
  const out: string[] = [];
  if (!d.units || d.units <= 0) out.push("units");
  if (!d.type) out.push("type");
  if (!d.legalName?.trim()) out.push("legalName");
  if (!d.email?.trim()) out.push("email");
  if (!d.accreditation?.length) out.push("accreditation");
  if (d.usPerson === undefined) out.push("usPerson");
  return out;
}
