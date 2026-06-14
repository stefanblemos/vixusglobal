import { Prisma } from "@prisma/client";

/**
 * Aritmética monetária com Decimal (decimal.js do Prisma) — NUNCA usar float.
 * Todo valor em dinheiro carrega uma moeda (ISO 4217) no nível do dado.
 */
export type Decimal = Prisma.Decimal;
export type DecimalInput = Prisma.Decimal.Value;

export const D = (v: DecimalInput): Decimal => new Prisma.Decimal(v);
export const ZERO = new Prisma.Decimal(0);

/** Soma uma lista de valores Decimal. */
export function sum(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, v) => acc.add(D(v)), ZERO);
}

/** Arredonda para casas decimais (padrão 2) com HALF_UP — apenas para exibição. */
export function round(v: DecimalInput, dp = 2): Decimal {
  return D(v).toDecimalPlaces(dp, Prisma.Decimal.ROUND_HALF_UP);
}

/** Formata um valor monetário com a moeda (ex.: "1.234,56 USD"). */
export function formatMoney(v: DecimalInput, currency: string, locale = "en-US"): string {
  const n = Number(round(v, 2));
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(n);
  } catch {
    return `${round(v, 2).toString()} ${currency}`;
  }
}
