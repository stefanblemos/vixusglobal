// Marcos de construção (#73) — funções puras. O catálogo (CatalogBuildMilestone) define
// as fases e pesos globais; a casa guarda { key: dataISO } das concluídas. O % de obra é
// a soma dos pesos marcados; o draw esperado é % × loan (estimativa da leva 1 — a leitura
// do budget do banco com valores reais vem na leva 2).

export type MilestoneCatalog = { key: string; name: string; detail: string | null; weightPct: number; sortOrder: number };
export type HouseMilestones = Record<string, string>; // { key: "AAAA-MM-DD" }

// % de obra pelos marcos (0–100), somando os pesos das fases concluídas. Null quando a
// casa ainda não tem nenhum marco (deixa o cálculo por draws assumir — modo híbrido).
export function milestonePct(catalog: MilestoneCatalog[], done: HouseMilestones | null | undefined): number | null {
  if (!done || Object.keys(done).length === 0) return null;
  const sum = catalog.reduce((acc, m) => (done[m.key] ? acc + Number(m.weightPct) : acc), 0);
  return Math.min(100, Math.round(sum));
}

// % de obra pelos marcos concluídos ATÉ uma data (para o report as-of / congelado).
export function milestonePctAsOf(
  catalog: MilestoneCatalog[],
  done: HouseMilestones | null | undefined,
  asOf: Date,
): number | null {
  if (!done || Object.keys(done).length === 0) return null;
  const cut = asOf.getTime();
  const sum = catalog.reduce((acc, m) => {
    const d = done[m.key];
    return d && new Date(d).getTime() <= cut ? acc + Number(m.weightPct) : acc;
  }, 0);
  return Math.min(100, Math.round(sum));
}

// Draw esperado ACUMULADO (estimativa) = %obra × loan. O "drawable a pedir" desconta o que
// já foi sacado/pedido (creditado + pendente). Retainage só entra se vier do LOI (leva 2).
export function estimatedDrawable(args: {
  pct: number | null; // % de obra pelos marcos
  loanAmount: number; // bankLoanAmount da casa
  alreadyDrawn: number; // creditado + pendente já lançado p/ a casa
}): { expectedCumulative: number; toRequest: number } {
  const pct = args.pct ?? 0;
  const expectedCumulative = Math.round((args.loanAmount * pct) / 100);
  const toRequest = Math.max(0, expectedCumulative - args.alreadyDrawn);
  return { expectedCumulative, toRequest };
}

// resumo por marco p/ a UI: nome, peso, acumulado e se está concluído (+ data)
export function milestoneRows(catalog: MilestoneCatalog[], done: HouseMilestones | null | undefined) {
  const d = done ?? {};
  let cum = 0;
  return [...catalog]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((m) => {
      cum += Number(m.weightPct);
      return {
        key: m.key,
        name: m.name,
        detail: m.detail,
        weightPct: Number(m.weightPct),
        cumPct: cum,
        done: !!d[m.key],
        date: d[m.key] ?? null,
      };
    });
}
