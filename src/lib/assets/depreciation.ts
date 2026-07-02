import { prisma } from "@/lib/db";
import {
  depreciationSchedule,
  depreciationForYear,
  accumulatedThrough,
  type YearDep,
} from "./macrs";
import { categoryByKey } from "./categories";

export interface AssetView {
  id: string;
  companyId: string;
  companyName: string;
  name: string;
  category: string;
  categoryLabel: string;
  acquisitionDate: string; // ISO
  disposalDate: string | null; // baixa/venda (se houver)
  fullyDepreciatedYear: number | null; // contador zerou no livro até este ano (sem projeção depois)
  bookDepletedYear: number | null; // ano em que a depreciação REAL lançada no livro (AssetYearDepreciation) zerou o ativo (acumulado ≥ custo), mesmo sem a flag
  cost: number;
  recoveryYears: number;
  method: string;
  section179: number;
  bonusPct: number;
  yearDep: number; // depreciação MACRS efetiva no ano selecionado
  realDepYear: number; // depreciação REAL do ano: AssetYearDepreciation (livro) se registrada, senão a MACRS efetiva
  accumulated: number; // acumulada até o ano selecionado
  remaining: number; // base ainda a depreciar
  total: number; // depreciação total (vida toda)
  schedule: YearDep[];
}

export interface CompanyDep {
  companyId: string;
  companyName: string;
  yearDep: number; // MACRS efetiva do ano
  realDep: number; // depreciação REAL do ano (livro registrado onde houver, senão MACRS efetiva)
  accumulated: number;
}

export interface AssetRegister {
  year: number;
  years: number[];
  companies: { id: string; legalName: string }[];
  assets: AssetView[];
  byCompany: CompanyDep[];
  totalYearDep: number;
}

export async function buildAssetRegister(
  year: number,
  companyFilter?: string,
  opts?: { pureMacrs?: boolean }, // ignora "totalmente depreciado" e baixa → MACRS legal "deveria"
): Promise<AssetRegister> {
  const pure = opts?.pureMacrs ?? false;
  const [companies, assets] = await Promise.all([
    prisma.company.findMany({
      where: { jurisdiction: "US" },
      select: { id: true, legalName: true },
      orderBy: { legalName: "asc" },
    }),
    prisma.fixedAsset.findMany({
      // Só ativos US (MACRS) — os de Portugal (quotas constantes, €) têm registro à parte.
      where: { regime: "US", ...(companyFilter ? { companyId: companyFilter } : {}) },
      include: { company: { select: { legalName: true } } },
      orderBy: { acquisitionDate: "asc" },
    }),
  ]);

  // Depreciação real registrada por ativo/ano — para o "totalmente depreciado" usar o saldo REAL
  // (custo − registrado antes do ano), não a MACRS presumida. (No modo pura, o flag é ignorado.)
  const ayd = pure
    ? []
    : await prisma.assetYearDepreciation.findMany({
        where: { assetId: { in: assets.map((a) => a.id) } },
        select: { assetId: true, year: true, amount: true },
      });
  const aydByAsset = new Map<string, { year: number; amount: number }[]>();
  for (const r of ayd) {
    const arr = aydByAsset.get(r.assetId) ?? [];
    arr.push({ year: r.year, amount: Number(r.amount.toString()) });
    aydByAsset.set(r.assetId, arr);
  }

  const views: AssetView[] = assets.map((a) => {
    const cost = Number(a.cost.toString());
    // Ano em que a depreciação REAL do livro (entradas AssetYearDepreciation, da conferência) zerou
    // o ativo — acumulado ≥ custo. Captura o caso "contador expensou 100%" sem a flag fullyDep.
    const bookEntries = (aydByAsset.get(a.id) ?? []).slice().sort((x, y) => x.year - y.year);
    let bookAcc = 0;
    let bookDepletedYear: number | null = null;
    for (const e of bookEntries) {
      bookAcc += e.amount;
      if (bookDepletedYear == null && bookAcc >= cost - 0.01) bookDepletedYear = e.year;
    }
    // No modo EFETIVO (a dedução real, que alimenta o registro/reserve/preview), o livro também
    // TRUNCA o cronograma: se o contador já zerou o ativo — pela flag OU pelos lançamentos reais
    // cobrindo o custo — não há mais nada a depreciar; não projetar MACRS fantasma depois. A MACRS
    // pura ("deveria") ignora isso. O ano efetivo é o mais cedo entre flag e livro.
    const effectiveFullyDepYear = pure
      ? null
      : a.fullyDepreciatedYear != null && bookDepletedYear != null
        ? Math.min(a.fullyDepreciatedYear, bookDepletedYear)
        : (a.fullyDepreciatedYear ?? bookDepletedYear);
    const sched = depreciationSchedule({
      cost,
      section179: Number(a.section179.toString()),
      bonusPct: Number(a.bonusPct.toString()),
      recoveryYears: Number(a.recoveryYears.toString()),
      method: a.method === "SL_MM" ? "SL_MM" : a.method === "NONE" ? "NONE" : "MACRS",
      acquisitionYear: a.acquisitionDate.getUTCFullYear(),
      acquisitionMonth: a.acquisitionDate.getUTCMonth() + 1,
      // MACRS pura (deveria) ignora só os ajustes de LIVRO (totalmente depreciado). A BAIXA é evento
      // REAL (o ativo saiu): vale nos dois modos — meia-cota no ano da baixa e ZERO depois (a MACRS
      // legal também para de depreciar um ativo vendido/baixado).
      fullyDepreciatedYear: effectiveFullyDepYear,
      bookEntriesBeforeFullDep: aydByAsset.get(a.id) ?? [],
      disposalYear: a.disposalDate ? a.disposalDate.getUTCFullYear() : null,
      disposalMonth: a.disposalDate ? a.disposalDate.getUTCMonth() + 1 : null,
    });
    const accumulated = accumulatedThrough(sched, year);
    return {
      id: a.id,
      companyId: a.companyId,
      companyName: a.company.legalName,
      name: a.name,
      category: a.category,
      categoryLabel: categoryByKey(a.category).label,
      acquisitionDate: a.acquisitionDate.toISOString().slice(0, 10),
      disposalDate: a.disposalDate ? a.disposalDate.toISOString().slice(0, 10) : null,
      fullyDepreciatedYear: a.fullyDepreciatedYear ?? null,
      bookDepletedYear: pure ? null : bookDepletedYear,
      cost,
      recoveryYears: Number(a.recoveryYears.toString()),
      method: a.method,
      section179: Number(a.section179.toString()),
      bonusPct: Number(a.bonusPct.toString()),
      yearDep: depreciationForYear(sched, year),
      // Depreciação REAL do ano: o valor lançado no livro (AssetYearDepreciation) tem prioridade;
      // sem ele, cai na MACRS efetiva. No modo pura ("deveria"), é sempre a MACRS.
      realDepYear: (() => {
        const real = bookEntries.find((e) => e.year === year)?.amount;
        return !pure && real != null ? Math.round(real * 100) / 100 : depreciationForYear(sched, year);
      })(),
      accumulated,
      remaining: Math.round((cost - accumulated) * 100) / 100,
      total: sched.total,
      schedule: sched.schedule,
    };
  });

  const byCompanyMap = new Map<string, CompanyDep>();
  for (const v of views) {
    const g = byCompanyMap.get(v.companyId) ?? {
      companyId: v.companyId,
      companyName: v.companyName,
      yearDep: 0,
      realDep: 0,
      accumulated: 0,
    };
    g.yearDep += v.yearDep;
    g.realDep += v.realDepYear;
    g.accumulated += v.accumulated;
    byCompanyMap.set(v.companyId, g);
  }

  // Anos para o seletor: da aquisição mais antiga até o ano corrente + 1.
  const cur = new Date().getUTCFullYear();
  let minY = cur;
  for (const a of assets) minY = Math.min(minY, a.acquisitionDate.getUTCFullYear());
  const years: number[] = [];
  for (let y = cur + 1; y >= minY; y--) years.push(y);

  return {
    year,
    years,
    companies,
    assets: views,
    byCompany: [...byCompanyMap.values()].sort((a, b) => b.yearDep - a.yearDep),
    totalYearDep: Math.round(views.reduce((s, v) => s + v.yearDep, 0) * 100) / 100,
  };
}
