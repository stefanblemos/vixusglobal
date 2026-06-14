// Catálogos de domínio para formulários e validação.

export const JURISDICTIONS = [
  { value: "US", label: "United States" },
  { value: "BR", label: "Brazil" },
  { value: "PT", label: "Portugal" },
  { value: "OTHER", label: "Other" },
] as const;

export type JurisdictionValue = (typeof JURISDICTIONS)[number]["value"];

// Tipologias válidas por jurisdição (rótulo amigável).
export const ENTITY_TYPES_BY_JURISDICTION: Record<
  JurisdictionValue,
  { value: string; label: string }[]
> = {
  US: [
    { value: "LLC", label: "LLC" },
    { value: "C_CORP", label: "C-Corp" },
    { value: "S_CORP", label: "S-Corp" },
    { value: "PA", label: "PA (Professional Association)" },
    { value: "LP", label: "LP" },
    { value: "LLP", label: "LLP" },
    { value: "SOLE_PROP", label: "Sole Proprietorship" },
  ],
  BR: [
    { value: "LTDA", label: "LTDA" },
    { value: "SLU", label: "Single-member Ltd (SLU)" },
    { value: "SA", label: "S.A." },
    { value: "MEI", label: "MEI" },
    { value: "EI", label: "Sole Proprietor (EI)" },
  ],
  PT: [
    { value: "LDA", label: "Lda (private limited)" },
    { value: "UNIPESSOAL_LDA", label: "Unipessoal Lda" },
    { value: "SA", label: "S.A." },
    { value: "ENI", label: "Sole Trader (ENI)" },
  ],
  OTHER: [{ value: "OTHER", label: "Other" }],
};

export const ALL_ENTITY_TYPE_VALUES = Array.from(
  new Set(Object.values(ENTITY_TYPES_BY_JURISDICTION).flatMap((arr) => arr.map((e) => e.value))),
) as [string, ...string[]];

// Formas de tributação por jurisdição (rótulo amigável).
export const TAX_TREATMENTS_BY_JURISDICTION: Record<
  JurisdictionValue,
  { value: string; label: string }[]
> = {
  US: [
    { value: "DISREGARDED", label: "Disregarded (single-member LLC)" },
    { value: "PARTNERSHIP", label: "Partnership (1065)" },
    { value: "S_CORP", label: "S-Corp (1120-S)" },
    { value: "C_CORP", label: "C-Corp (1120)" },
    { value: "SOLE_PROP", label: "Sole Proprietorship (Sch. C)" },
  ],
  BR: [
    { value: "LUCRO_REAL", label: "Lucro Real" },
    { value: "LUCRO_PRESUMIDO", label: "Lucro Presumido" },
    { value: "SIMPLES_NACIONAL", label: "Simples Nacional" },
    { value: "MEI", label: "MEI" },
  ],
  PT: [
    { value: "REGIME_GERAL", label: "Regime Geral" },
    { value: "REGIME_SIMPLIFICADO", label: "Regime Simplificado" },
  ],
  OTHER: [{ value: "OTHER", label: "Other" }],
};

export const ALL_TAX_TREATMENT_VALUES = Array.from(
  new Set(Object.values(TAX_TREATMENTS_BY_JURISDICTION).flatMap((arr) => arr.map((e) => e.value))),
) as [string, ...string[]];

const TAX_TREATMENT_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(TAX_TREATMENTS_BY_JURISDICTION).flatMap((arr) =>
    arr.map((e) => [e.value, e.label]),
  ),
);
export const labelForTaxTreatment = (v: string) => TAX_TREATMENT_LABELS[v] ?? v;

export const RELATIONSHIPS = [
  { value: "GROUP_MEMBER", label: "Group member (ownership)" },
  { value: "MANAGED_ONLY", label: "Managed only (no ownership)" },
] as const;

export const PARTY_KINDS = [
  { value: "PERSON", label: "Individual" },
  { value: "ENTITY", label: "Entity / company" },
] as const;

// Verifica se a combinação tipologia × jurisdição é válida.
export function isEntityTypeValidFor(jurisdiction: string, entityType: string): boolean {
  const list = ENTITY_TYPES_BY_JURISDICTION[jurisdiction as JurisdictionValue];
  return !!list && list.some((e) => e.value === entityType);
}

const ENTITY_TYPE_LABELS: Record<string, string> = Object.fromEntries(
  Object.values(ENTITY_TYPES_BY_JURISDICTION).flatMap((arr) => arr.map((e) => [e.value, e.label])),
);
const JURISDICTION_LABELS: Record<string, string> = Object.fromEntries(
  JURISDICTIONS.map((j) => [j.value, j.label]),
);
const RELATIONSHIP_LABELS: Record<string, string> = Object.fromEntries(
  RELATIONSHIPS.map((r) => [r.value, r.label]),
);
const PARTY_KIND_LABELS: Record<string, string> = Object.fromEntries(
  PARTY_KINDS.map((k) => [k.value, k.label]),
);

export const labelForEntityType = (v: string) => ENTITY_TYPE_LABELS[v] ?? v;
export const labelForJurisdiction = (v: string) => JURISDICTION_LABELS[v] ?? v;
export const labelForRelationship = (v: string) => RELATIONSHIP_LABELS[v] ?? v;
export const labelForPartyKind = (v: string) => PARTY_KIND_LABELS[v] ?? v;
