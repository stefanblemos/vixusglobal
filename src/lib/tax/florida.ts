import { prisma } from "@/lib/db";
import { yearRates } from "./reserve";
import { buildTaxPreview } from "./preview";

const r2 = (n: number) => Math.round(n * 100) / 100;

// Previsão do Florida Corporate Income Tax (controle separado). Regras aplicadas:
//  - Incide só sobre C-corp; pass-through (LLC/partnership/S-corp) não paga IR de renda estadual.
//  - Alíquota e isenção vêm de Settings por ano (default 5.5% / $50.000); renda 100% Flórida.
//  - Base = MESMA base do Tax preview (lucro book + add-backs M-1 + depreciação real + K-1 cascateado),
//    fonte única. O FL tax aqui É o `stateEstimate` do preview → as duas telas concordam por
//    construção. Antes usava buildTaxReserve (base magra, sem M-1/K-1) e divergia.

export interface FloridaRow {
  companyId: string;
  name: string;
  taxableProfit: number;
  exemptionApplied: number;
  flTaxable: number;
  flTax: number;
  estimateRequired: boolean; // FL tax > $2.500 → estimados obrigatórios
  installment: number; // parcela trimestral (FL tax / 4)
}

// Vencimentos dos estimados FL (F-1120ES) — último dia dos meses 4/6/9 e do ano (calendário).
// ⚠️ confirmar datas exatas com o contador.
export const FL_ESTIMATE_DUE = ["Apr 30", "Jun 30", "Sep 30", "Dec 31"];
export const FL_ESTIMATE_THRESHOLD = 2500;

export interface FloridaForecast {
  year: number;
  rate: number;
  exemption: number;
  rows: FloridaRow[];
  totalTax: number;
  passThroughFl: { name: string; treatment: string | null }[]; // FL, mas não-C-corp (info)
}

export async function buildFloridaForecast(year: number): Promise<FloridaForecast> {
  const [preview, yr, companies] = await Promise.all([
    buildTaxPreview(year),
    yearRates(year),
    prisma.company.findMany({ where: { jurisdiction: "US" }, select: { id: true, state: true } }),
  ]);
  const stateById = new Map(companies.map((c) => [c.id, (c.state ?? "").toUpperCase()]));
  const { flPct: FL_RATE, flExemption: FL_EXEMPTION } = yr;
  const isFl = (id: string) => stateById.get(id) === "FL";

  const out: FloridaRow[] = preview.rows
    .filter((r) => r.kind === "company" && r.entityType === "C-corp" && isFl(r.id))
    .map((r) => {
      // Base rica ANTES do estadual = o que o preview usou para o stateEstimate.
      const tp = r2(r.taxable + r.stateEstimate + r.stateEstInterest);
      const exemptionApplied = tp > 0 ? Math.min(FL_EXEMPTION, tp) : 0;
      const flTaxable = Math.max(0, tp - FL_EXEMPTION);
      const flTax = r.stateEstimate; // == flTaxable × FL_RATE/100 (mesma conta do preview)
      return {
        companyId: r.id,
        name: r.name,
        taxableProfit: tp,
        exemptionApplied,
        flTaxable,
        flTax,
        estimateRequired: flTax > FL_ESTIMATE_THRESHOLD,
        installment: r2(flTax / 4),
      };
    })
    .filter((r) => r.flTax > 0.005 || r.taxableProfit > 0.005)
    .sort((a, b) => b.flTax - a.flTax);

  const passThroughFl = preview.rows
    .filter((r) => r.kind === "company" && r.entityType !== "C-corp" && isFl(r.id))
    .map((r) => ({ name: r.name, treatment: r.entityType }));

  return {
    year,
    rate: FL_RATE,
    exemption: FL_EXEMPTION,
    rows: out,
    totalTax: r2(out.reduce((s, r) => s + r.flTax, 0)),
    passThroughFl,
  };
}
