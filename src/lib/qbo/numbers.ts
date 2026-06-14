// Conversão dos números do QBO (formato US) para Decimal-string segura.
// Ex.: "234,924.19" → "234924.19" ; "-$8,000.00" → "-8000.00" ;
//      "(1,234.00)" → "-1234.00" ; "$0.00" → "0" ; "" → null

export function parseQboNumber(raw: string | undefined | null): string | null {
  if (raw == null) return null;
  let s = raw.trim();
  if (s === "" || s === "-") return null;

  // Parênteses indicam negativo: (1,234) → -1234
  let negative = false;
  if (s.startsWith("(") && s.endsWith(")")) {
    negative = true;
    s = s.slice(1, -1).trim();
  }

  // Remove cifrão, espaços e separadores de milhar
  s = s.replace(/\$/g, "").replace(/\s/g, "").replace(/,/g, "");

  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  if (s === "" || !/^\d*\.?\d+$/.test(s)) return null;

  const normalized = negative ? `-${s}` : s;
  // Normaliza "-0" / "0.00" para "0" sem alterar precisão real
  if (Number(normalized) === 0) return "0";
  return normalized;
}
