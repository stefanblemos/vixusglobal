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

export function qboPeriodKey(label: string): number {
  const lower = label.toLowerCase();
  const years = label.match(/(?:19|20)\d{2}/g);
  const year = years ? Math.max(...years.map(Number)) : 0;
  // Mês: pega o maior mês citado (para "As of Dec 31" = 12; para "Jan–Dec" = fim do ano).
  let month = 0;
  for (const k of Object.keys(MONTHS)) {
    if (lower.includes(k)) month = Math.max(month, MONTHS[k]);
  }
  // Dia: primeiro número de 1–2 dígitos (ex.: "As of Jun 14, 2026" → 14).
  const dm = label.match(/\b(\d{1,2})\b/);
  const day = dm ? Number(dm[1]) : 0;
  return year * 10000 + (month || 12) * 100 + day;
}
