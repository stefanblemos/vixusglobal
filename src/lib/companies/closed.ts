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

export async function loadClosedResolver(): Promise<ClosedResolver> {
  const [companies, finalReturns] = await Promise.all([
    prisma.company.findMany({ select: { id: true, closedDate: true } }),
    prisma.taxReturn.findMany({
      where: { isFinalReturn: true, companyId: { not: null } },
      select: { companyId: true, year: true },
    }),
  ]);
  const finalYear = new Map<string, number>();
  for (const r of finalReturns) {
    if (!r.companyId || r.year == null) continue;
    const cur = finalYear.get(r.companyId);
    if (cur == null || r.year > cur) finalYear.set(r.companyId, r.year);
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
