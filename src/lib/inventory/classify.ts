/**
 * Inventory (16/11/2026) — classificação das linhas da invoice da Archway e leitura do que
 * a invoice cita (containers, invoices de mercadoria na "Consolidation").
 * Portado do mock "Rateio de Importação" (app.src.html, blocos 1-2). Módulo puro.
 */

export const COST_GROUPS = ["duties", "freight", "insurance", "services", "bank", "other"] as const;
export type CostGroup = (typeof COST_GROUPS)[number];
export const COST_GROUP_LABEL: Record<CostGroup, string> = {
  duties: "Impostos de importação",
  freight: "Frete e handling",
  insurance: "Seguro de carga",
  services: "Serviços de importação",
  bank: "Despesas bancárias",
  other: "Outros custos",
};

export const isProductActivity = (activity: string) => /^products?\s*:/i.test(activity ?? "");

/** Grupo de custo de uma linha que NÃO é produto. */
export function classifyCost(activity: string, desc = ""): CostGroup {
  const a = (activity ?? "").toLowerCase();
  const d = (desc ?? "").toLowerCase();
  if (a.includes("bank charge")) return "bank";
  if (a.includes("professional service")) return "services";
  if (a.includes("custom duties") || a.includes("duty") || d.includes("custom duties")) return "duties";
  if (a.includes("insurance")) return "insurance";
  if (a.includes("shipping") || a.includes("freight") || a.includes("handling")) return "freight";
  if (/clearance|terminal|chassis|unloading|cross-?dock|flatbed|delivery|disbursement|over ?weight|tri-?axle/.test(d)) return "freight";
  return "other";
}

/** Nome do produto como vem na invoice ("Products:HHK-Disk Light" → "HHK-Disk Light"). */
export const productName = (activity: string) => (activity ?? "").replace(/^products?\s*:\s*/i, "").trim();

/** Rótulo curto de uma linha de custo (p/ listas). */
export function costLabel(activity: string, desc: string | null | undefined): string {
  const act = (activity ?? "").trim();
  const first = (desc ?? "")
    .split("\n")
    .map((x) => x.trim())
    .find((x) => x && x.length > 2 && !/^\*/.test(x) && !/^model|^color/i.test(x));
  if (/shipping and handling/i.test(act) && first) return first;
  const tail = act.split(":").pop() ?? act;
  return first && first.length < 48 ? `${tail} — ${first}` : tail;
}

/** Containers citados (código ISO: 4 letras + 6-7 dígitos) no campo Container e no memo. */
export function containersOf(container: string | null | undefined, memo: string[]): string[] {
  const txt = [container ?? "", ...(memo ?? [])].join(" ");
  return [...new Set(txt.match(/\b[A-Z]{4}\d{6,7}\b/g) ?? [])];
}

/** Invoices citadas na consolidação ("Invoice 26051 disk light"). */
export function refsOf(memo: string[], ownNo: string | null): { no: string; label: string }[] {
  const out: { no: string; label: string }[] = [];
  const seen = new Set<string>();
  for (const m of memo ?? []) {
    const re = /invoice\s*#?\s*(\d{4,6})\s*([^|]*)/gi;
    let mm: RegExpExecArray | null;
    while ((mm = re.exec(m))) {
      if (seen.has(mm[1]) || mm[1] === String(ownNo ?? "")) continue;
      seen.add(mm[1]);
      out.push({ no: mm[1], label: (mm[2] ?? "").replace(/[*•]/g, "").trim() });
    }
  }
  return out;
}

/** Termos da invoice de frete que indicam os últimos custos de um embarque (sugerir "fechar custos"). */
export function hasCloseHint(lines: { activity: string; desc?: string | null }[], terms: string[]): string | null {
  const t = terms.map((x) => x.toLowerCase()).filter(Boolean);
  for (const l of lines) {
    const blob = `${l.activity} ${l.desc ?? ""}`.toLowerCase();
    const hit = t.find((k) => blob.includes(k));
    if (hit) return hit;
  }
  return null;
}
