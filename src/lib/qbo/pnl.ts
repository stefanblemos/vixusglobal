// Totais de um Profit & Loss do QBO (para comparar com o IR).
type Line = { lineType: string; label: string; value: unknown };

const subject = (label: string) => {
  const m = label.match(/^total\s+(?:(?:for|para|do|da|de)\s+)?(.+)$/i);
  return (m?.[1] ?? label.replace(/^total\s+/i, "")).trim().toLowerCase();
};

export function pnlTotals(lines: Line[]) {
  const find = (key: string) => {
    const l = lines.find((x) => x.lineType === "TOTAL" && subject(x.label) === key);
    return l?.value != null ? Number(l.value) : null;
  };
  const operatingIncome = find("income");
  const otherIncome = find("other income"); // ex.: distribuição de participações (1099)
  const operatingExpenses = find("expenses");
  const otherExpenses = find("other expenses");

  // Receita total = renda operacional + outras receitas (other income entra como receita).
  const income =
    operatingIncome != null || otherIncome != null
      ? (operatingIncome ?? 0) + (otherIncome ?? 0)
      : null;
  const expenses =
    operatingExpenses != null || otherExpenses != null
      ? (operatingExpenses ?? 0) + (otherExpenses ?? 0)
      : null;
  const netIncome = income != null && expenses != null ? income - expenses : null;

  return { income, operatingIncome, otherIncome, expenses, netIncome };
}
