import { normalizeName } from "@/lib/qbo/match";

// Todos os nomes pelos quais uma empresa pode ser conhecida — razão social,
// nome fantasia e aliases (nomes antigos/variações vistos em QBO/IR). O IR de uma
// investida costuma listar o sócio pelo nome ANTIGO (ex.: L&L → L2), então casar
// só pela razão social atual falha.
export function entityNames(c: {
  legalName: string;
  tradeName: string | null;
  aliases: string[];
}): string[] {
  return [c.legalName, c.tradeName, ...c.aliases].filter((x): x is string => !!x);
}

// Um sócio do K-1 casa com um dono registrado se o nome bater com QUALQUER um dos
// nomes conhecidos (razão social / fantasia / alias), normalizado.
export function ownerNameMatches(registeredNames: string[], partnerName: string): boolean {
  const pn = normalizeName(partnerName);
  return registeredNames.some((n) => normalizeName(n) === pn);
}
