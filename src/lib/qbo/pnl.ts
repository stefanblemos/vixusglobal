// Totais de um Profit & Loss do QBO (para comparar com o IR).
type Line = { lineType: string; label: string; value: unknown };

const subject = (label: string) => {
  const m = label.match(/^total\s+(?:for|para|do|da|de)\s+(.+)$/i);
  return (m?.[1] ?? label.replace(/^total\s+/i, "")).trim().toLowerCase();
};

export function pnlTotals(lines: Line[]) {
  const find = (key: string) => {
    const l = lines.find((x) => x.lineType === "TOTAL" && subject(x.label) === key);
    return l?.value != null ? Number(l.value) : null;
  };
  const income = find("income");
  const expenses = find("expenses");
  const other = find("other expenses");
  const totalExpenses = expenses != null || other != null ? (expenses ?? 0) + (other ?? 0) : null;
  const netIncome = income != null && totalExpenses != null ? income - totalExpenses : null;
  return { income, expenses: totalExpenses, netIncome };
}
