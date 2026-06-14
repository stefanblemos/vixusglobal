// Detecta relacionamentos (loans / ownership) a partir das linhas de um import QBO,
// usando o sectionPath de cada conta-folha.

export type SuggestionKind = "LOAN_RECEIVABLE" | "LOAN_PAYABLE" | "OWNERSHIP";

export interface DetectLine {
  label: string;
  lineType: string; // SECTION | ACCOUNT | TOTAL
  sectionPath: string[];
  amount: string | null; // decimal-string
}

export interface Suggestion {
  kind: SuggestionKind;
  counterpartyName: string;
  amount: string | null;
  section: string;
}

const RULES: { match: RegExp; kind: SuggestionKind }[] = [
  { match: /loans?\s+to\s+others/i, kind: "LOAN_RECEIVABLE" },
  { match: /investments?\s*-\s*other\s+companies/i, kind: "OWNERSHIP" },
  { match: /loan\s+payable|notes?\s+payable/i, kind: "LOAN_PAYABLE" },
];

// Marcadores de entidade (empresa/pessoa) vs. imóvel/conta interna.
const ENTITY_HINT =
  /\b(llc|inc|corp|co|ltd|lp|llp|pa|group|holdings?|investments?|partners?|company|lda|ltda|s\.?a\.?|unipessoal|capital|ventures?|trust|fund)\b/i;
const ADDRESS_HINT =
  /\b(dr|ct|way|ln|st|ave|rd|ter|blvd|pl|cir|trl|hwy|drive|court|lane|street|avenue|road|terrace|place|circle|trail)\b/i;
const ACCOUNT_CODE = /^\s*\d{1,4}\s*-\s/; // "01- General Account"
const INTERNAL_ACCT = /\b(general\s+account|suspense|clearing|undeposited|opening\s+balance)\b/i;

// Decide se a contraparte parece uma entidade real (vale sugerir cadastro)
// ou um imóvel/conta interna (não deve virar empresa).
export function looksLikeEntity(name: string): boolean {
  if (ENTITY_HINT.test(name)) return true; // tem LLC/Inc/Ltda/... → entidade
  if (ACCOUNT_CODE.test(name) || INTERNAL_ACCT.test(name)) return false; // conta interna
  if (ADDRESS_HINT.test(name) && /\d/.test(name)) return false; // endereço com número → imóvel
  if (/,\s*[A-Z]{2}\.?\s*$/.test(name)) return false; // termina em estado (", FL")
  return true;
}

export function detectSuggestions(lines: DetectLine[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const l of lines) {
    if (l.lineType !== "ACCOUNT") continue;
    if (!looksLikeEntity(l.label)) continue; // pula imóveis e contas internas
    for (const rule of RULES) {
      const section = l.sectionPath.find((s) => rule.match.test(s));
      if (section) {
        out.push({ kind: rule.kind, counterpartyName: l.label, amount: l.amount, section });
        break;
      }
    }
  }
  return out;
}

export const SUGGESTION_LABEL: Record<SuggestionKind, string> = {
  LOAN_RECEIVABLE: "Loan receivable",
  LOAN_PAYABLE: "Loan payable",
  OWNERSHIP: "Ownership stake",
};
