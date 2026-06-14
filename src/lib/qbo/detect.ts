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

export function detectSuggestions(lines: DetectLine[]): Suggestion[] {
  const out: Suggestion[] = [];
  for (const l of lines) {
    if (l.lineType !== "ACCOUNT") continue;
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
