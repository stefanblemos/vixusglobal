import { buildTaxPreview } from "@/lib/tax/preview";
import { buildDistributableReport } from "@/lib/tax/distributable";
import { yearRates } from "@/lib/tax/rates";

// SIMULADOR DE IMPOSTO ("botão analisar"): roda cenários LEGÍTIMOS e ranqueia pela economia potencial
// do grupo. Transparente — cada cenário mostra a conta (atual vs alternativa), as premissas e o alerta
// "confirmar com o contador". NÃO é caixa-preta nem sugere posição agressiva; é o delta sob premissas
// explícitas, para levar ao contador. Lever 1: roteamento de distribuição (base já tributada vs preso
// na C-corp). Lever 2: eleição S vs C (dupla tributação da C-corp).

const DIV_RATE = 0.20; // dividendo qualificado (~15–23,8%; usamos 20% como meio)

export interface Scenario {
  id: string;
  lever: "election" | "routing";
  title: string;
  entity: string;
  currentTax: number; // imposto no cenário atual
  altTax: number; // imposto no cenário alternativo
  saving: number; // currentTax − altTax (positivo = oportunidade)
  detail: string;
  assumptions: string[];
  caveat: string;
}

export interface RoutingRow {
  owner: string;
  kind: string;
  taxFree: number; // pode mover sem imposto (base já tributada)
  trapped: number; // preso em C-corp (sairia como dividendo)
  trappedCost: number; // custo estimado se puxar o preso (dividendo)
}

export interface TaxSimulation {
  year: number;
  years: number[];
  scenarios: Scenario[]; // ranqueados por economia
  totalPotential: number; // soma das economias > 0
  routing: RoutingRow[];
  totalTaxFree: number;
  totalTrapped: number;
}

export async function buildTaxSimulation(year: number): Promise<TaxSimulation> {
  const [preview, dist, yr] = await Promise.all([
    buildTaxPreview(year),
    buildDistributableReport(year).catch(() => null),
    yearRates(year),
  ]);
  const ptRate = yr.passPct / 100; // pass-through marginal (proxy da provisão do reserve)

  const scenarios: Scenario[] = [];

  // ── Lever 2: eleição S vs C (só C-corp com base positiva) ──
  for (const r of preview.rows) {
    if (r.entityType !== "C-corp" || r.taxable <= 0) continue;
    const corpTax = Math.round((r.tax + r.stateEstimate) * 100) / 100; // federal 21% + estadual do ano
    const afterCorp = r.taxable - corpTax;
    const cTotal = Math.round((corpTax + Math.max(0, afterCorp) * DIV_RATE) * 100) / 100; // dupla: corp + dividendo
    const sTotal = Math.round(r.taxable * ptRate * 100) / 100; // passa aos donos (~alíquota pass-through)
    const saving = Math.round((cTotal - sTotal) * 100) / 100;
    scenarios.push({
      id: `election-${r.id}`,
      lever: "election",
      title: `${r.name}: eleger S-corp?`,
      entity: r.name,
      currentTax: cTotal,
      altTax: sTotal,
      saving,
      detail: `Como C-corp com distribuição integral: ${corpTax.toLocaleString("en-US")} de imposto corporativo + dividendo sobre ${Math.max(0, afterCorp).toLocaleString("en-US")} = ${cTotal.toLocaleString("en-US")}. Como pass-through (S): a base ${r.taxable.toLocaleString("en-US")} passa aos donos ≈ ${sTotal.toLocaleString("en-US")}.`,
      assumptions: [`Distribuição integral do lucro`, `Dividendo qualificado a ${Math.round(DIV_RATE * 100)}%`, `Pass-through na alíquota de ${yr.passPct}%`],
      caveat: "A dupla tributação da C-corp só morde ao DISTRIBUIR — retendo, a C-corp difere a 2ª camada. Eleição S tem regras de elegibilidade (≤100 sócios PF/US, uma classe de ação) e efeitos não-fiscais. Confirmar com o contador.",
    });
  }

  // ── Lever 1: roteamento de distribuição (base já tributada vs preso na C-corp) ──
  const routing: RoutingRow[] = [];
  if (dist) {
    for (const o of dist.owners) {
      const trapped = Math.round(o.trappedInCorp.reduce((s, t) => s + t.share, 0) * 100) / 100;
      routing.push({
        owner: o.name,
        kind: o.kind,
        taxFree: Math.round(o.total * 100) / 100,
        trapped,
        trappedCost: Math.round(trapped * DIV_RATE * 100) / 100,
      });
    }
    routing.sort((a, b) => b.taxFree + b.trapped - (a.taxFree + a.trapped));
  }

  scenarios.sort((a, b) => b.saving - a.saving);
  const totalPotential = Math.round(scenarios.filter((s) => s.saving > 0).reduce((s, x) => s + x.saving, 0) * 100) / 100;
  const totalTaxFree = Math.round(routing.reduce((s, r) => s + r.taxFree, 0) * 100) / 100;
  const totalTrapped = Math.round(routing.reduce((s, r) => s + r.trapped, 0) * 100) / 100;

  return { year, years: preview.years, scenarios, totalPotential, routing, totalTaxFree, totalTrapped };
}
