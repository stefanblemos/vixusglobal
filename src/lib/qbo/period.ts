// Chave ordenável (YYYYMMDD) do período de um relatório QBO, para achar o MAIS RECENTE
// por período (não por data de upload). Lida com rótulos EN e PT.
const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
  // PT
  fev: 2,
  abr: 4,
  mai: 5,
  ago: 8,
  set: 9,
  out: 10,
  dez: 12,
};

// Mês inicial e final cobertos por um rótulo de período ("January - March, 2025" → 1..3;
// "March 2025" → 3..3; "January-December, 2024" → 1..12). null se não achar mês.
export function periodMonths(label: string): { start: number; end: number } | null {
  const lower = label.toLowerCase();
  const found: { idx: number; m: number }[] = [];
  for (const [k, m] of Object.entries(MONTHS)) {
    // Início de palavra: a chave é prefixo do mês (EN "march"/PT "setembro" começam por "mar"/"set").
    // Sem o \b, "set" casava em "asset", "ago" em "Chicago" — mês fantasma dentro de outra palavra.
    const idx = lower.search(new RegExp("\\b" + k));
    if (idx >= 0) found.push({ idx, m });
  }
  if (found.length === 0) return null;
  found.sort((a, b) => a.idx - b.idx);
  return { start: found[0].m, end: found[found.length - 1].m };
}

export function qboPeriodKey(label: string): number {
  const lower = label.toLowerCase();
  const years = label.match(/(?:19|20)\d{2}/g);
  const year = years ? Math.max(...years.map(Number)) : 0;
  // Mês: pega o maior mês citado (para "As of Dec 31" = 12; para "Jan–Dec" = fim do ano).
  let month = 0;
  for (const k of Object.keys(MONTHS)) {
    if (new RegExp("\\b" + k).test(lower)) month = Math.max(month, MONTHS[k]);
  }
  // Dia: primeiro número de 1–2 dígitos (ex.: "As of Jun 14, 2026" → 14).
  const dm = label.match(/\b(\d{1,2})\b/);
  const day = dm ? Number(dm[1]) : 0;
  return year * 10000 + (month || 12) * 100 + day;
}
