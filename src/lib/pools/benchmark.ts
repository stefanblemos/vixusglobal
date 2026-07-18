import marketStats from "@/data/market-stats.json";
import type { SimUnitResult } from "@/lib/pools/simulator";

/**
 * Benchmark de premissas × mercado (ATTOM, vendidos): lote por location e venda por
 * modelo×location, com percentil na distribuição real do submarket. Quando o modelo tem
 * sqft cadastrado, a venda compara em $/SF (o benchmark justo — preço absoluto mistura
 * tamanhos); sem sqft, compara preço absoluto com a ressalva. Obra não tem benchmark no
 * MLS — fica de fora por honestidade. Aprovado pelo Stefan em 14/07/2026 (demo com dados).
 */

export type BenchmarkVerdict = "CONSERVATIVE" | "IN_RANGE" | "TOP" | "BELOW" | "NO_DATA";

export type BenchmarkRow = {
  kind: "lot" | "sale";
  label: string; // "Marion Oaks" ou "Grumari @ Marion Oaks"
  ours: number;
  unit: "$" | "$/sf";
  marketMedian: number | null;
  n: number; // tamanho da amostra (vendidos)
  percentile: number | null;
  deltaPct: number | null; // ours/mediana − 1
  verdict: BenchmarkVerdict;
};

// location do catálogo → submarket do ATTOM ("Citrus" cobre Citrus Springs)
const SUBMARKET_OF: Array<[RegExp, string]> = [
  [/marion/i, "marion-oaks"],
  [/citrus/i, "citrus-springs"],
  [/rainbow/i, "rainbow-lakes"],
  [/rolling/i, "rolling-hills"],
  [/poinciana/i, "poinciana"],
];

type Sub = (typeof marketStats.submarkets)[number];

function subOf(locationName: string): Sub | null {
  const key = SUBMARKET_OF.find(([re]) => re.test(locationName))?.[1];
  return key ? (marketStats.submarkets.find((s) => s.key === key) ?? null) : null;
}

// Estatísticas de NC vendidas do submercado da location (Fase 1: farol lucro × mercado)
export function ncStatsForLocation(locationName: string): {
  name: string;
  median: number;
  p90: number;
  max: number;
  dom: number;
  n: number;
} | null {
  const sub = subOf(locationName);
  const prices = (sub?.benchmark?.ncSoldPrices ?? []).slice().sort((a, b) => a - b);
  if (!sub || prices.length === 0) return null;
  return {
    name: sub.name,
    median: median(prices) ?? 0,
    p90: prices[Math.min(prices.length - 1, Math.floor(prices.length * 0.9))],
    max: prices[prices.length - 1],
    dom: sub.medianDaysOnMarket,
    n: prices.length,
  };
}

const median = (a: number[]) =>
  a.length === 0 ? null : a.length % 2 ? a[(a.length - 1) / 2] : (a[a.length / 2 - 1] + a[a.length / 2]) / 2;

const pctOf = (v: number, sorted: number[]) =>
  sorted.length === 0 ? null : Math.round((100 * sorted.filter((x) => x <= v).length) / sorted.length);

function saleVerdict(pct: number | null): BenchmarkVerdict {
  if (pct == null) return "NO_DATA";
  if (pct >= 90) return "TOP"; // premissa de venda no topo do mercado — atenção
  if (pct <= 50) return "CONSERVATIVE";
  return "IN_RANGE";
}

function lotVerdict(delta: number | null): BenchmarkVerdict {
  if (delta == null) return "NO_DATA";
  if (delta >= 0) return "CONSERVATIVE"; // pagar acima da mediana = colchão de custo
  if (delta < -0.2) return "BELOW"; // 20%+ abaixo do vendido — confirmar disponibilidade
  return "IN_RANGE";
}

export function benchmarkOf(
  units: SimUnitResult[],
  sqftByModel: Map<string, number | null>,
): { rows: BenchmarkRow[]; extractDate: string; windowDays: number } {
  const rows: BenchmarkRow[] = [];

  // Lotes: um por location (valor puro, já com override da aba Premissas)
  const byLoc = new Map<string, number>();
  for (const u of units) if (!byLoc.has(u.locationName)) byLoc.set(u.locationName, u.lotCost);
  for (const [loc, lotCost] of byLoc) {
    const sub = subOf(loc);
    const sold = sub?.benchmark?.lotsSold ?? [];
    const med = median(sold);
    rows.push({
      kind: "lot",
      label: loc,
      ours: lotCost,
      unit: "$",
      marketMedian: med,
      n: sold.length,
      percentile: pctOf(lotCost, sold),
      deltaPct: med ? lotCost / med - 1 : null,
      verdict: sold.length < 5 ? "NO_DATA" : lotVerdict(med ? lotCost / med - 1 : null),
    });
  }

  // Vendas: uma por combinação (modelo @ location); $/SF quando o modelo tem sqft
  const byCombo = new Map<string, SimUnitResult>();
  for (const u of units) {
    const key = `${u.modelName} @ ${u.locationName}`;
    if (!byCombo.has(key)) byCombo.set(key, u);
  }
  for (const [label, u] of byCombo) {
    const sub = subOf(u.locationName);
    const sqft = sqftByModel.get(u.modelName) ?? null;
    if (sqft && sub?.benchmark?.ncPpsf?.length) {
      const ppsf = u.salePrice / sqft;
      const dist = sub.benchmark.ncPpsf;
      const med = median(dist);
      const pct = pctOf(ppsf, dist);
      rows.push({
        kind: "sale",
        label,
        ours: Math.round(ppsf * 10) / 10,
        unit: "$/sf",
        marketMedian: med == null ? null : Math.round(med * 10) / 10,
        n: dist.length,
        percentile: pct,
        deltaPct: med ? ppsf / med - 1 : null,
        verdict: dist.length < 5 ? "NO_DATA" : saleVerdict(pct),
      });
    } else {
      const dist = sub?.benchmark?.ncSoldPrices ?? [];
      const med = median(dist);
      const pct = pctOf(u.salePrice, dist);
      rows.push({
        kind: "sale",
        label,
        ours: u.salePrice,
        unit: "$",
        marketMedian: med,
        n: dist.length,
        percentile: pct,
        deltaPct: med ? u.salePrice / med - 1 : null,
        verdict: dist.length < 5 ? "NO_DATA" : saleVerdict(pct),
      });
    }
  }

  return { rows, extractDate: marketStats.extractDate, windowDays: marketStats.windowDays };
}
