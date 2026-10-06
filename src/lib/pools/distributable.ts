import type { EndNetLine } from "./investor-value";

/**
 * Teste de caixa distribuível (06/10/2026, aprovado pelo Stefan). Antes do fim do projeto só se
 * devolve CAPITAL, e só até o "distribuível seguro":
 *   caixa − juros/fees por vir − obra além do envelope − closing das não vendidas
 *         − despesas provisionadas (inclui performance provisionada) − encerramento da SPV
 *         − colchão de stress (10% do preço planejado das não vendidas)
 * LUCRO só com todas as casas vendidas e loans quitados (override justificado e auditado).
 * As parcelas vêm da MESMA cascata do fim líquido (computeEndNet) — fonte única.
 */

export const STRESS_PCT = 0.10;

export type DistributableItem = { key: string; label: string; amount: number };
export type Distributable = {
  cash: number;
  items: DistributableItem[]; // reservas (positivas)
  safe: number; // caixa − reservas (pode ser negativo)
  unsoldCount: number;
  openLoans: number; // loans com saldo > 0
  profitAllowed: boolean; // sem casa aberta e sem loan em aberto
};

const r2 = (v: number) => Math.round(v * 100) / 100;

const LABELS: Record<string, string> = {
  financing: "Juros e fees por vir dos loans",
  equityBuild: "Obra que falta além do envelope do banco",
  closings: "Closing das casas não vendidas",
  provisioned: "Despesas provisionadas (inclui performance provisionada)",
  windDown: "Encerramento da SPV (estimado)",
  vehicle: "Custos do veículo por vir",
  stress: `Colchão de stress (${Math.round(STRESS_PCT * 100)}% das vendas não realizadas)`,
};

export function computeDistributable(args: {
  cash: number;
  endNetLines: EndNetLine[];
  unsoldPlannedSales: number;
  unsoldCount: number;
  openLoans: number;
}): Distributable {
  const items: DistributableItem[] = [];
  for (const l of args.endNetLines) {
    if (!(l.key in LABELS)) continue;
    const v = Math.abs(l.amount);
    if (v > 0.01) items.push({ key: l.key, label: LABELS[l.key], amount: r2(v) });
  }
  const stress = r2(args.unsoldPlannedSales * STRESS_PCT);
  if (stress > 0.01) items.push({ key: "stress", label: LABELS.stress, amount: stress });
  const reserves = items.reduce((s, i) => s + i.amount, 0);
  return {
    cash: r2(args.cash),
    items,
    safe: r2(args.cash - reserves),
    unsoldCount: args.unsoldCount,
    openLoans: args.openLoans,
    profitAllowed: args.unsoldCount === 0 && args.openLoans === 0,
  };
}

// ── Resumo da performance do pool (acordo × decisões gravadas) ─────────────────────
export type PerformanceSummary = {
  agreedPct: number | null;
  payeeName: string | null;
  timing: string | null;
  waiveRemaining: boolean;
  provisioned: number; // decidido "provisionar" e ainda não acertado
  paid: number;
  waived: number;
  settled: number; // paid + provisioned (já decidido sobre o lucro passado)
};

export function performanceSummary(pool: {
  performancePct: unknown | null;
  profitShareTiming: string | null;
  performanceWaiveRemaining: boolean;
  performancePayeeCompany?: { legalName: string } | null;
  performancePayeeParty?: { name: string } | null;
  expenses: Array<{ category: string; status: string; amount: unknown }>;
}): PerformanceSummary {
  const perf = pool.expenses.filter((e) => e.category === "PERFORMANCE");
  const sum = (st: string) => r2(perf.filter((e) => e.status === st).reduce((s, e) => s + Number(e.amount), 0));
  const provisioned = sum("PROVISIONED"), paid = sum("PAID");
  return {
    agreedPct: pool.performancePct != null ? Number(pool.performancePct) : null,
    payeeName: pool.performancePayeeCompany?.legalName ?? pool.performancePayeeParty?.name ?? null,
    timing: pool.profitShareTiming,
    waiveRemaining: pool.performanceWaiveRemaining,
    provisioned,
    paid,
    waived: sum("WAIVED"),
    settled: r2(provisioned + paid),
  };
}
