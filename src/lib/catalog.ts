// Catálogos de domínio para formulários e validação.

export const JURISDICTIONS = [
  { value: "US", label: "Estados Unidos" },
  { value: "BR", label: "Brasil" },
  { value: "PT", label: "Portugal" },
  { value: "OTHER", label: "Outra" },
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
    { value: "SLU", label: "Sociedade Unipessoal (SLU)" },
    { value: "SA", label: "S.A." },
    { value: "MEI", label: "MEI" },
    { value: "EI", label: "Empresário Individual" },
  ],
  PT: [
    { value: "LDA", label: "Lda (Sociedade por Quotas)" },
    { value: "UNIPESSOAL_LDA", label: "Unipessoal Lda" },
    { value: "SA", label: "S.A." },
    { value: "ENI", label: "Empresário em Nome Individual" },
  ],
  OTHER: [{ value: "OTHER", label: "Outra" }],
};

export const ALL_ENTITY_TYPE_VALUES = Array.from(
  new Set(Object.values(ENTITY_TYPES_BY_JURISDICTION).flatMap((arr) => arr.map((e) => e.value))),
) as [string, ...string[]];

export const RELATIONSHIPS = [
  { value: "GROUP_MEMBER", label: "Do grupo (participação)" },
  { value: "MANAGED_ONLY", label: "Administrada (gestão, sem participação)" },
] as const;

export const PARTY_KINDS = [
  { value: "PERSON", label: "Pessoa física" },
  { value: "ENTITY", label: "Pessoa jurídica / entidade" },
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
