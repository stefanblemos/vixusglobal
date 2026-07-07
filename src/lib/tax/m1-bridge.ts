import { prisma } from "@/lib/db";
import { buildTaxPreview } from "@/lib/tax/preview";
import { baselineFig } from "@/lib/tax/audit-vs-ir";
import { figuresByCompany } from "@/lib/ir/figures";

// PONTE M-1 (livro → imposto), por entidade, nas LINHAS reais do Schedule M-1: começa no lucro por
// livro (QBO) e reconstrói cada ajuste até o taxable income — o mesmo caminho do tax preview, agora
// formalizado como o contador declara. Compara o resultado com a figura do IR (baselineFig). É o topo
// da missão "conferir o contador": você entrega isto ao contador e confere linha a linha.

export interface M1Line {
  code: string; // linha do Schedule M-1 (1, 2, 4, 5, 8, 10)
  label: string;
  amount: number;
  sign: "+" | "−" | "=";
  detail?: string;
}
export interface M1Entity {
  companyId: string;
  name: string;
  acronym: string;
  entityType: string;
  lines: M1Line[];
  taxable: number; // linha 10 (computado)
  irTaxable: number | null; // figura do IR comparável
  irKey: string | null;
  diff: number | null; // computado − IR
  matches: boolean | null;
}
export interface M1Bridge {
  year: number;
  years: number[];
  entities: M1Entity[];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const within = (a: number, b: number) => Math.abs(a - b) <= Math.max(1000, 0.08 * Math.abs(b));

export async function buildM1Bridge(year: number): Promise<M1Bridge> {
  const preview = await buildTaxPreview(year);
  const rets = await prisma.taxReturn.findMany({
    where: { companyId: { not: null }, year },
    select: { companyId: true, figures: true, manualFigures: true },
  });
  const figsByCo = figuresByCompany(rets);

  const entities: M1Entity[] = [];
  for (const r of preview.rows) {
    if (r.kind !== "company" || !r.hasPnl) continue;

    // Separa o IR federal (linha 2) dos demais add-backs de despesa (linha 5).
    const federalItem = r.nonDeductibleItems.find((i) => /federal/i.test(i.label));
    const line5Items = r.nonDeductibleItems.filter((i) => !/federal/i.test(i.label));
    const line5Total = r2(line5Items.reduce((s, i) => s + i.amount, 0) + r.stateTaxAddBack);

    const lines: M1Line[] = [
      { code: "1", label: "Net income per book (QBO)", amount: r2(r.bookNet), sign: "=" },
    ];
    if (federalItem) lines.push({ code: "2", label: "Federal income tax", amount: r2(federalItem.amount), sign: "+", detail: "never deductible" });
    if (r.k1In) lines.push({ code: "4", label: "Taxable income outside the book (K-1 received)", amount: r2(r.k1In), sign: "+", detail: "from pass-through investees" });
    if (line5Total) {
      const parts = [
        ...line5Items.map((i) => `${i.label} ${Math.round(i.amount).toLocaleString("en-US")}`),
        ...(r.stateTaxAddBack ? [`state tax paid ${Math.round(r.stateTaxAddBack).toLocaleString("en-US")}`] : []),
      ];
      lines.push({ code: "5", label: "Book expenses non-deductible on the return", amount: line5Total, sign: "+", detail: parts.join(" · ") });
    }
    if (r.depAdj && r.depAdj < 0) lines.push({ code: "8", label: "Deductions on the return outside the book (MACRS depreciation)", amount: r2(-r.depAdj), sign: "−", detail: "book without depreciation → applies MACRS" });
    else if (r.depAdj && r.depAdj > 0) lines.push({ code: "5", label: "Depreciation adjustment (book > MACRS)", amount: r2(r.depAdj), sign: "+" });
    lines.push({ code: "10", label: "Taxable income", amount: r2(r.taxable), sign: "=" });

    const figs = figsByCo.get(r.id);
    const base = figs ? baselineFig(r.entityType, figs) : null;
    const irTaxable = base?.value ?? null;
    const diff = irTaxable != null ? r2(r.taxable - irTaxable) : null;

    entities.push({
      companyId: r.id, name: r.name, acronym: r.acronym, entityType: r.entityType,
      lines, taxable: r2(r.taxable), irTaxable, irKey: base?.key ?? null,
      diff, matches: irTaxable != null ? within(r.taxable, irTaxable) : null,
    });
  }

  entities.sort((a, b) => {
    // divergentes primeiro, depois sem IR, depois os que conferem
    const rank = (e: M1Entity) => (e.matches === false ? 0 : e.matches == null ? 1 : 2);
    return rank(a) - rank(b) || b.taxable - a.taxable;
  });

  return { year, years: preview.years, entities };
}
