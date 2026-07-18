/**
 * Projeção líquida do investidor (Fase 4, mock v2 aprovado 19/07/2026): a 3ª marcação
 * da régua par → hoje (NAV conservador) → FIM. Vende o não-vendido A MERCADO
 * (benchmark ATTOM; fallback plano com selo), desconta custo p/ terminar, closing das
 * vendas, payoff + custos do financiamento por vir (risk.ts), despesas provisionadas,
 * encerramento da SPV (estimado quando há entity sem provisão) e performance/promote.
 * Módulo puro — investor view, drill e report usam a mesma cascata.
 */

import { marketEstimateForHouse, type MarketEstimate } from "./benchmark";

const round2 = (v: number) => Math.round(v * 100) / 100;

export type EndNetHouse = {
  addr: string;
  sold: boolean;
  plannedLotCost: number | null;
  plannedBuildCost: number | null;
  plannedClosingCost: number | null;
  plannedSalePrice: number | null;
  ownCapital: number;
  bankDrawn: number;
  locationName: string | null;
  sqft: number | null;
};

export type EndNetLine = {
  key:
    | "cash"
    | "futureSales"
    | "remainingCosts"
    | "financing"
    | "provisioned"
    | "windDown"
    | "performance"
    | "promote"
    | "vehicle";
  amount: number; // sinal já aplicado (positivo soma, negativo subtrai)
};

export type EndNetResult = {
  lines: EndNetLine[];
  endValueNet: number;
  endPerUnitNet: number | null;
  houses: Array<{ addr: string; est: MarketEstimate; plannedSale: number | null }>;
  windDownEstimated: boolean; // usamos o default — sugerir provisão no pool
  flagsNoBenchmark: string[]; // casas projetadas sem amostra ATTOM
};

export const WIND_DOWN_DEFAULT = 2500; // dissolução FL + 1065 final + registered agent

export function computeEndNet(opts: {
  freeCash: number; // caixa disponível hoje (livre de provisões NÃO — passar bruto e provisões à parte)
  houses: EndNetHouse[];
  debt: number; // saldo devido dos loans hoje (payoff)
  financingComing: number; // juros + fees por vir (risk.custosPorVir dos loans ativos)
  provisionedExpenses: number;
  hasEntity: boolean;
  hasWindDownProvision: boolean;
  raised: number;
  distributed: number;
  investorProfitSharePct: number | null; // fração do lucro DOS INVESTIDORES (cadastro)
  promotePlan: number | null; // simKpis.promoteTotal (plano, ≈)
  vehicleCostPlan: number | null; // simKpis.vehicleCostTotal (plano, ≈)
  expensesPaid: number;
  unitsTotal: number;
}): EndNetResult {
  const unsold = opts.houses.filter((h) => !h.sold);
  const houses = unsold.map((h) => ({
    addr: h.addr,
    plannedSale: h.plannedSalePrice,
    est: marketEstimateForHouse(h.locationName, h.sqft, h.plannedSalePrice),
  }));
  // sem estimativa NENHUMA (nem benchmark, nem plano): piso conservador = custo incorrido
  // (equity + banco) — a casa não some da projeção; o selo pede preço/avaliação
  const futureSales = round2(
    houses.reduce((s, h, i) => s + (h.est.value ?? unsold[i].ownCapital + unsold[i].bankDrawn), 0),
  );

  // custo p/ terminar: obra planejada − incorrido (draws do banco + equity além do lote)
  const remainingBuild = unsold.reduce((s, h) => {
    const build = h.plannedBuildCost ?? 0;
    const lot = h.plannedLotCost ?? 0;
    const incurred = h.bankDrawn + Math.max(0, h.ownCapital - lot);
    return s + Math.max(0, build - incurred);
  }, 0);
  const closingCosts = unsold.reduce((s, h) => s + (h.plannedClosingCost ?? 0), 0);
  const remainingCosts = round2(remainingBuild + closingCosts);

  const windDownEstimated = opts.hasEntity && !opts.hasWindDownProvision;
  const windDown = windDownEstimated ? WIND_DOWN_DEFAULT : 0;

  // veículo restante (plano − já pago/provisionado) — aproximação marcada com ≈ na UI
  const vehicleRemaining = Math.max(
    0,
    (opts.vehicleCostPlan ?? 0) - opts.expensesPaid - opts.provisionedExpenses,
  );

  const subtotal =
    opts.freeCash + futureSales - remainingCosts - opts.debt - opts.financingComing -
    opts.provisionedExpenses - windDown - vehicleRemaining;

  // performance da 4U sobre o LUCRO projetado (lucro = valor final + distribuído − captado)
  const profitProjected = Math.max(0, subtotal + opts.distributed - opts.raised);
  const performance =
    opts.investorProfitSharePct != null
      ? round2((1 - opts.investorProfitSharePct) * profitProjected)
      : 0;
  const promote = opts.promotePlan ?? 0;

  const endValueNet = round2(subtotal - performance - promote);
  const lines: EndNetLine[] = [
    { key: "cash", amount: round2(opts.freeCash) },
    { key: "futureSales", amount: futureSales },
    { key: "remainingCosts", amount: -remainingCosts },
    { key: "financing", amount: -round2(opts.debt + opts.financingComing) },
    ...(opts.provisionedExpenses > 0
      ? [{ key: "provisioned" as const, amount: -round2(opts.provisionedExpenses) }]
      : []),
    ...(windDown > 0 ? [{ key: "windDown" as const, amount: -windDown }] : []),
    ...(vehicleRemaining > 0.01 ? [{ key: "vehicle" as const, amount: -round2(vehicleRemaining) }] : []),
    ...(performance > 0 ? [{ key: "performance" as const, amount: -performance }] : []),
    ...(promote > 0 ? [{ key: "promote" as const, amount: -round2(promote) }] : []),
  ];
  return {
    lines,
    endValueNet,
    endPerUnitNet: opts.unitsTotal > 0 ? round2(endValueNet / opts.unitsTotal) : null,
    houses,
    windDownEstimated,
    flagsNoBenchmark: houses.filter((h) => h.est.method === "NO_BENCHMARK").map((h) => h.addr),
  };
}
