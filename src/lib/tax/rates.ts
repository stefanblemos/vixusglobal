import { prisma } from "@/lib/db";

// FONTE ÚNICA das alíquotas de provisão por ANO (TaxRateYear, editável em /tax-settings). Mora aqui
// (módulo neutro) para que tanto o reserve quanto o tax preview leiam o MESMO lugar — sem cada um ter
// sua própria constante (a alíquota/​isenção de Florida valia em dois sítios antes).
export const DEFAULT_PASS_RATE = 30;

export interface YearRates {
  corpPct: number; // C-corp federal (21)
  passPct: number; // demais/owner (30)
  flPct: number; // Florida corporate (5,5)
  flExemption: number; // isenção anual Florida ($50k)
}

export async function yearRates(year: number): Promise<YearRates> {
  const row = await prisma.taxRateYear.findUnique({ where: { year } });
  return {
    corpPct: row ? Number(row.corpPct) : 21,
    passPct: row ? Number(row.passPct) : DEFAULT_PASS_RATE,
    flPct: row ? Number(row.flPct) : 5.5,
    flExemption: row ? Number(row.flExemption) : 50000,
  };
}
