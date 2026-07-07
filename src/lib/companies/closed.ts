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
  const [companies, allReturns] = await Promise.all([
    prisma.company.findMany({ select: { id: true, closedDate: true } }),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null }, year: { not: null } },
      select: { id: true, companyId: true, year: true, isFinalReturn: true, taxForm: true },
    }),
  ]);
  // Retornos por empresa (todos, não só os finais) — para saber se há CONTINUAÇÃO após um IR final.
  const normForm = (s: string | null): string | null => (s ?? "").replace(/^form\s+/i, "").trim().toUpperCase() || null;
  const byCompany = new Map<string, { id: string; year: number; isFinal: boolean; form: string | null }[]>();
  for (const r of allReturns) {
    if (!r.companyId || r.year == null) continue;
    (byCompany.get(r.companyId) ?? byCompany.set(r.companyId, []).get(r.companyId)!).push({
      id: r.id,
      year: r.year,
      isFinal: r.isFinalReturn,
      form: normForm(r.taxForm),
    });
  }
  // Ano do IR final que REALMENTE encerra. Um "final return" só fecha se NÃO houver CONTINUAÇÃO da
  // entidade — onde continuação = um IR de ano POSTERIOR, ou de FORMULÁRIO DIFERENTE no mesmo ano (o
  // caso da conversão: 4U trocou S-corp→partnership em 2025 e o 1120-S "final" convive com o 1065 do
  // mesmo ano → a 4U não fechou). Um IR do MESMO formulário/ano é duplicata, NÃO continuação (senão um
  // upload duplicado des-fecharia uma empresa realmente encerrada). Antes, qualquer isFinalReturn fechava.
  const finalYear = new Map<string, number>();
  for (const [id, rs] of byCompany) {
    for (const f of rs) {
      if (!f.isFinal) continue;
      const continues = rs.some(
        (r) =>
          r.id !== f.id &&
          (r.year > f.year || (r.year === f.year && !!r.form && !!f.form && r.form !== f.form)),
      );
      if (continues) continue;
      const cur = finalYear.get(id);
      if (cur == null || f.year < cur) finalYear.set(id, f.year);
    }
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
