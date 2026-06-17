// Helpers da ponte IR × livros (QBO): decompõem o "other income" do IR em renda operacional
// (página 1, linhas 5–7), K-1 pass-through (linha 4) e renda separadamente declarada na
// Schedule K (juros/dividendos/etc.) — para reconhecer corretamente o que está na declaração
// e só sinalizar como omissão a renda faturada nos livros que não aparece em lugar nenhum.
// Usado pela página do ano da empresa e pelo painel de conferência consolidado.

export type Figure = { key: string; label: string; value: number | null; line: string | null };

// Other income do IR = Total income (linha 8) − Gross profit (= soma das linhas 4–7),
// robusto a como a IA classificou cada linha (ex.: linha 4 "from other partnerships").
export function irOtherIncomeOf(figures: Figure[]): number | null {
  const fv = (k: string) => figures.find((f) => f.key === k)?.value ?? null;
  const rev = fv("GROSS_RECEIPTS");
  const cogs = fv("COST_OF_GOODS");
  const gp = rev != null ? rev - (cogs ?? 0) : null;
  const ti = fv("TOTAL_INCOME");
  return ti != null && gp != null ? ti - gp : fv("OTHER_INCOME");
}

// K-1 pass-through (linha 4 do 1065: "from other partnerships, estates, and trusts").
export function irPassThroughOf(figures: Figure[]): number | null {
  const f = figures.find(
    (x) =>
      /other partnerships|estates,? and trusts|outras sociedades/i.test(x.label) ||
      /\bline\s*4\b/i.test(x.line ?? ""),
  );
  return f?.value ?? null;
}

// Other income OPERACIONAL do IR = linhas 5–7 (total das 4–7 menos o pass-through da 4).
export function irOperatingOtherIncomeOf(figures: Figure[]): number | null {
  const total = irOtherIncomeOf(figures);
  if (total == null) return null;
  return total - (irPassThroughOf(figures) ?? 0);
}

// Renda SEPARADAMENTE DECLARADA na Schedule K (juros 5, dividendos 6a, royalties 7, aluguel
// 2/3c, ganhos 8/9a/10, outros 11). Exclui a 20a (Investment income), memo que duplicaria.
// Casa "Sch K line 5" ou "Schedule K line 5" (a IA abrevia).
export const SEP_STATED_K_LINE = /(?:^|\s)k\s+line\s*(2|3c|5|6a|7|8|9a|9b|10|11)\b/i;
export function irSeparatelyStatedIncomeOf(figures: Figure[]): number | null {
  const items = figures.filter((f) => f.value != null && SEP_STATED_K_LINE.test(f.line ?? ""));
  if (items.length === 0) return null;
  return items.reduce((s, f) => s + (f.value ?? 0), 0);
}

// Renda faturada nos livros (QBO) que NÃO aparece NEM na renda operacional (linhas 5–7) NEM
// separadamente declarada na Schedule K — aí sim é possível omissão. Só sinaliza acima da
// tolerância.
export function booksIncomeNotOnReturnOf(
  figures: Figure[],
  pnlOtherIncome: number | null,
): number | null {
  if (pnlOtherIncome == null) return null;
  const onReturn =
    (irOperatingOtherIncomeOf(figures) ?? 0) + (irSeparatelyStatedIncomeOf(figures) ?? 0);
  const gap = pnlOtherIncome - onReturn;
  return gap > Math.max(1, Math.abs(pnlOtherIncome) * 0.01) ? gap : null;
}
