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
  // Subtotais que o PRÓPRIO QBO já calcula (linhas "Gross Profit"/"Net Income"/"Net Operating
  // Income", que NÃO começam com "Total"). São mais confiáveis que remontar a partir das seções —
  // pegam coisas como Inventory Shrinkage no COGS, que um total de seção pode não somar.
  const direct = (name: string) => {
    const l = lines.find((x) => x.label.trim().toLowerCase() === name && x.value != null);
    return l ? Number(l.value) : null;
  };

  // Camadas do P&L do QBO. COGS é uma SEÇÃO separada (entre Income e Expenses) —
  // precisa ser descontado, senão o net income fica errado (caso L&L 2019).
  const revenue = find("income"); // Total Income (receita bruta, antes do COGS)
  const directGross = direct("gross profit");
  const directNoi = direct("net operating income");
  const directNet = direct("net income");

  // COGS: se o QBO traz o Gross Profit, deriva o COGS dele (= receita − gross profit) — assim
  // o Inventory Shrinkage e afins entram, mesmo que o "Total Cost of Goods Sold" não os some.
  const cogs =
    directGross != null && revenue != null ? revenue - directGross : find("cost of goods sold");
  const operatingExpenses = find("expenses");
  const otherIncome = find("other income"); // distribuição de participações (1099), etc.
  const otherExpenses = find("other expenses");

  const grossProfit = directGross ?? (revenue != null ? revenue - (cogs ?? 0) : null);
  const netOperatingIncome =
    directNoi ?? (grossProfit != null ? grossProfit - (operatingExpenses ?? 0) : null);
  // "income" comparável à linha 8 do 1065 (gross profit + other income, já líquido de COGS).
  const income = grossProfit != null ? grossProfit + (otherIncome ?? 0) : null;
  const netIncome =
    directNet ??
    (grossProfit != null
      ? grossProfit - (operatingExpenses ?? 0) + (otherIncome ?? 0) - (otherExpenses ?? 0)
      : null);

  // Despesa total = operacional + outras (o 1065 junta tudo na linha 21 "Total deductions").
  const expenses =
    operatingExpenses != null || otherExpenses != null
      ? (operatingExpenses ?? 0) + (otherExpenses ?? 0)
      : null;

  return {
    revenue,
    cogs,
    grossProfit,
    operatingExpenses,
    otherIncome,
    otherExpenses,
    expenses,
    netOperatingIncome,
    income,
    netIncome,
  };
}
