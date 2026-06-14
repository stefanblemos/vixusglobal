import { prisma } from "@/lib/db";

const QUOTES = ["BRL", "EUR", "GBP"];
const BASE = "USD";

/**
 * Busca as taxas USD→{BRL,EUR,GBP} numa data (frankfurter.app, grátis, sem chave)
 * e grava no banco — "travando" a taxa daquela data. Idempotente.
 * Uso típico: chamado por um cron no fim de cada mês (sem intervenção humana).
 */
export async function fetchAndLockRates(
  dateStr: string,
): Promise<{ date: string; rates: Record<string, number> }> {
  const url = `https://api.frankfurter.app/${dateStr}?base=${BASE}&symbols=${QUOTES.join(",")}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`FX fetch failed: ${res.status}`);
  const data = (await res.json()) as { date: string; rates: Record<string, number> };
  const date = new Date(`${data.date}T00:00:00Z`);

  for (const [quote, rate] of Object.entries(data.rates)) {
    await prisma.fxRate.upsert({
      where: { base_quote_date: { base: BASE, quote, date } },
      update: { rate: String(rate), source: "frankfurter", fetchedAt: new Date() },
      create: { base: BASE, quote, date, rate: String(rate), source: "frankfurter" },
    });
  }
  return data;
}

/** Último dia do mês anterior (para o lock de fim de mês), em YYYY-MM-DD UTC. */
export function previousMonthEnd(now: Date): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
  return d.toISOString().slice(0, 10);
}

/** Carrega as taxas (base USD) vigentes até `asOf`: Map quote→rate (mais recente ≤ asOf). */
export async function loadRatesAsOf(asOf: Date): Promise<Map<string, number>> {
  const rows = await prisma.fxRate.findMany({
    where: { base: BASE, date: { lte: asOf } },
    orderBy: { date: "desc" },
  });
  const map = new Map<string, number>();
  for (const r of rows) if (!map.has(r.quote)) map.set(r.quote, Number(r.rate));
  return map;
}

/** Converte `amount` de `currency` para USD (1 USD = rate `currency`). Sem taxa → mantém. */
export function toUsd(amount: number, currency: string, rates: Map<string, number>): number {
  if (currency === BASE) return amount;
  const r = rates.get(currency);
  return r ? amount / r : amount;
}
