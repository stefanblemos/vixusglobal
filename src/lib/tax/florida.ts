import { buildTaxReserve, yearRates } from "./reserve";

// Previsão do Florida Corporate Income Tax (controle separado). Regras aplicadas:
//  - Incide só sobre C-corp; pass-through (LLC/partnership/S-corp) não paga IR de renda estadual.
//  - Alíquota e isenção vêm de Settings por ano (default 5.5% / $50.000); renda 100% Flórida.
//  - Base = lucro tributável já ajustado pela depreciação (MACRS) e prejuízo.

export interface FloridaRow {
  companyId: string;
  name: string;
  taxableProfit: number;
  exemptionApplied: number;
  flTaxable: number;
  flTax: number;
}

export interface FloridaForecast {
  year: number;
  rate: number;
  exemption: number;
  rows: FloridaRow[];
  totalTax: number;
  passThroughFl: { name: string; treatment: string | null }[]; // FL, mas não-C-corp (info)
}

export async function buildFloridaForecast(year: number): Promise<FloridaForecast> {
  const [{ rows }, yr] = await Promise.all([buildTaxReserve(year), yearRates(year)]);
  const { flPct: FL_RATE, flExemption: FL_EXEMPTION } = yr;
  const inFl = rows.filter((r) => (r.state ?? "").toUpperCase() === "FL");
  const isCcorp = (t: string | null) => (t ?? "").toUpperCase() === "C_CORP";

  const out: FloridaRow[] = inFl
    .filter((r) => isCcorp(r.taxTreatment))
    .map((r) => {
      const tp = r.taxableProfit ?? 0;
      const exemptionApplied = tp > 0 ? Math.min(FL_EXEMPTION, tp) : 0;
      const flTaxable = Math.max(0, tp - FL_EXEMPTION);
      const flTax = Math.round(flTaxable * FL_RATE) / 100; // flTaxable × alíquota
      return { companyId: r.companyId, name: r.name, taxableProfit: tp, exemptionApplied, flTaxable, flTax };
    })
    .sort((a, b) => b.flTax - a.flTax);

  const passThroughFl = inFl
    .filter((r) => !isCcorp(r.taxTreatment))
    .map((r) => ({ name: r.name, treatment: r.taxTreatment }));

  return {
    year,
    rate: FL_RATE,
    exemption: FL_EXEMPTION,
    rows: out,
    totalTax: Math.round(out.reduce((s, r) => s + r.flTax, 0) * 100) / 100,
    passThroughFl,
  };
}
