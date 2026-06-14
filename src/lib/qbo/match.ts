// Normalização e matching de nomes de entidade vindos do QBO.
// Os nomes vêm inconsistentes (typos, sufixos, pontuação), então casamos
// por forma normalizada contra legalName, tradeName e aliases.

// Remove prefixos descritivos comuns de linhas de empréstimo, para casar o nome
// da contraparte (ex.: "Empréstimo - Vixus..." → "Vixus...", "Loan - X" → "X").
const LOAN_PREFIX =
  /^(loan payable to|loan payable|loans? to others|loan|empréstimo matriz|empréstimo|emprestimo matriz|emprestimo|notes? payable to|notes? payable|matriz)\s*[-:]?\s*/i;

export function stripLoanPrefix(s: string): string {
  return s.trim().replace(LOAN_PREFIX, "").trim();
}

export function normalizeName(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[.,'"]/g, "")
    .replace(/\b(llc|inc|corp|co|ltd|lp|llp|pa|company|investments?|partners?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export interface CompanyMatchCandidate {
  id: string;
  legalName: string;
  tradeName: string | null;
  aliases: string[];
}

/** Retorna o id da empresa cujo nome normalizado bate com o nome de origem, ou null. */
export function matchCompany(
  sourceName: string,
  companies: CompanyMatchCandidate[],
): string | null {
  const target = normalizeName(stripLoanPrefix(sourceName));
  if (!target) return null;
  for (const c of companies) {
    const names = [c.legalName, c.tradeName ?? "", ...c.aliases].filter(Boolean);
    if (names.some((n) => normalizeName(n) === target)) return c.id;
  }
  return null;
}

/** Retorna o id da pessoa/entidade (Party) cujo nome normalizado bate, ou null. */
export function matchParty(
  sourceName: string,
  parties: { id: string; name: string }[],
): string | null {
  const target = normalizeName(stripLoanPrefix(sourceName));
  if (!target) return null;
  for (const p of parties) {
    if (normalizeName(p.name) === target) return p.id;
  }
  return null;
}
