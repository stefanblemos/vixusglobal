import marketStats from "@/data/market-stats.json";
import { ncStatsForLocation } from "@/lib/pools/benchmark";

/**
 * Absorção de mercado por local — a fonte que o otimizador usa para não encharcar um
 * modelo num local ("evitar usar sempre os mesmos modelos"). Regra do Stefan (22/07):
 *  - onde há ATTOM, o feed manda (NC vendidas na janela → anualizado);
 *  - onde não há (Orlando, Port Charlotte fora do feed), usa o número MANUAL do Catalog
 *    (CatalogLocation.absorptionPerYear), na MESMA unidade — casas novas vendidas/ano.
 *
 * O cap concorrente (quantas casas do MESMO produto o otimizador arranca por ciclo sem
 * saturar) deriva da absorção × participação de mercado tolerada × duração do ciclo. A
 * participação é tunável (agressividade); o resto é dado.
 */

const WINDOW_DAYS = marketStats.windowDays; // janela da amostra ATTOM (90d)

export type AbsorptionSource = "ATTOM" | "MANUAL" | "NONE";

export type Absorption = {
  perYear: number | null; // casas novas vendidas/ano no submercado (todos os builders)
  source: AbsorptionSource;
};

// Participação de mercado tolerada do MESMO modelo, por padrão — o quanto a 4U aceita ser
// de um único produto num local sem "encharcar". Conservador de propósito; ajustável.
export const DEFAULT_MARKET_SHARE_PCT = 8;

// Absorção anual de um local: ATTOM (anualizado da janela) tem prioridade; senão o manual.
export function absorptionForLocation(
  locationName: string,
  manualPerYear: number | null | undefined,
): Absorption {
  const nc = ncStatsForLocation(locationName);
  if (nc && nc.n > 0) {
    return { perYear: Math.round((nc.n * 365) / WINDOW_DAYS), source: "ATTOM" };
  }
  if (manualPerYear != null && manualPerYear > 0) {
    return { perYear: manualPerYear, source: "MANUAL" };
  }
  return { perYear: null, source: "NONE" };
}

// Quantas casas do mesmo produto cabem por ciclo sem saturar. perYear × share × (ciclo/ano).
// Sem dado de absorção (NONE) devolve null = "sem limite conhecido" — o otimizador coloca
// assim mesmo, mas o modal marca "sem absorção — usar com cautela".
export function capConcurrent(
  perYear: number | null,
  cycleDays: number,
  sharePct: number = DEFAULT_MARKET_SHARE_PCT,
): number | null {
  if (perYear == null || perYear <= 0) return null;
  const cycleYears = Math.max(cycleDays, 1) / 365;
  return Math.max(1, Math.ceil((perYear * (sharePct / 100)) * cycleYears));
}
