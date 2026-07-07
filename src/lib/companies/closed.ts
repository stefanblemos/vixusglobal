import { prisma } from "@/lib/db";

// FONTE ÚNICA de "empresa encerrada". O ano de fecho é o mais cedo conhecido entre o IR FINAL
// declarado (TaxReturn.isFinalReturn) e o closedDate da empresa. `isClosedBeforeYear(Y)` = encerrou
// ANTES de Y (no próprio ano do fecho ainda aparece, pois declara o IR final daquele ano). Usado por
// TODOS os consumidores (tax preview, reserve, completude) — nada de cada tela ter sua própria regra.

export type ClosedResolver = {
  closedYearOf: (companyId: string) => number | null;
  isClosedBeforeYear: (companyId: string, year: number) => boolean;
};

const yearFrom = (s: string | null | undefined): number | null =>
  s ? Number((s.match(/(?:19|20)\d\d/) ?? [])[0]) || null : null;

const normForm = (s: string | null): string | null =>
  (s ?? "").replace(/^form\s+/i, "").trim().toUpperCase() || null;

// Ano em que um "final return" REALMENTE encerra a entidade, a partir dos IRs DE UMA empresa. Um final
// return só fecha se não houver CONTINUAÇÃO: IR de ano posterior OU de formulário DIFERENTE no mesmo ano
// (conversão, ex.: 1120-S final + 1065). IR do mesmo formulário/ano = duplicata, não continuação. null =
// não encerra. FONTE ÚNICA — usada pelo resolver e pelas telas (empresa/lista) para não divergirem.
export type MiniReturn = { id: string; year: number | null; isFinalReturn: boolean; taxForm: string | null };
export function finalClosingYear(returns: MiniReturn[]): number | null {
  let closing: number | null = null;
  for (const f of returns) {
    if (!f.isFinalReturn || f.year == null) continue;
    const continues = returns.some(
      (r) =>
        r.id !== f.id &&
        r.year != null &&
        (r.year > f.year! ||
          (r.year === f.year && !!normForm(r.taxForm) && !!normForm(f.taxForm) && normForm(r.taxForm) !== normForm(f.taxForm))),
    );
    if (!continues) closing = closing == null ? f.year : Math.min(closing, f.year);
  }
  return closing;
}

export async function loadClosedResolver(): Promise<ClosedResolver> {
  const [companies, allReturns] = await Promise.all([
    prisma.company.findMany({ select: { id: true, closedDate: true } }),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null }, year: { not: null } },
      select: { id: true, companyId: true, year: true, isFinalReturn: true, taxForm: true },
    }),
  ]);
  // Retornos por empresa; o ano de encerramento vem do helper finalClosingYear (fonte única, ciente de
  // conversão: um final return só fecha se não houver continuação — ver o helper acima).
  const byCompany = new Map<string, MiniReturn[]>();
  for (const r of allReturns) {
    if (!r.companyId || r.year == null) continue;
    (byCompany.get(r.companyId) ?? byCompany.set(r.companyId, []).get(r.companyId)!).push(r);
  }
  const finalYear = new Map<string, number>();
  for (const [id, rs] of byCompany) {
    const cy = finalClosingYear(rs);
    if (cy != null) finalYear.set(id, cy);
  }
  const closedDateById = new Map(companies.map((c) => [c.id, c.closedDate]));
  const closedYearOf = (id: string): number | null => {
    const ys = [finalYear.get(id) ?? null, yearFrom(closedDateById.get(id))].filter(
      (y): y is number => y != null,
    );
    return ys.length ? Math.min(...ys) : null;
  };
  return {
    closedYearOf,
    isClosedBeforeYear: (id, year) => {
      const cy = closedYearOf(id);
      return cy != null && cy < year;
    },
  };
}
