// Normalização e matching de nomes de entidade vindos do QBO.
// Os nomes vêm inconsistentes (typos, sufixos, pontuação), então casamos
// por forma normalizada contra legalName, tradeName e aliases.

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
  const target = normalizeName(sourceName);
  if (!target) return null;
  for (const c of companies) {
    const names = [c.legalName, c.tradeName ?? "", ...c.aliases].filter(Boolean);
    if (names.some((n) => normalizeName(n) === target)) return c.id;
  }
  return null;
}
