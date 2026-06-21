import { prisma } from "@/lib/db";
import {
  ptDepreciationSchedule,
  ptDepreciationForYear,
  ptAccumulatedThrough,
  type YearDep,
} from "./pt-depreciation";
import { ptCategoryByKey } from "./pt-categories";

// Registro de ativos de Portugal (quotas constantes) — separado do MACRS (US),
// na moeda nativa da empresa (€). Sem §179/bonus; o terreno não deprecia.

export interface PtAssetView {
  id: string;
  companyId: string;
  companyName: string;
  currency: string;
  name: string;
  category: string;
  categoryLabel: string;
  acquisitionDate: string;
  cost: number;
  landValue: number;
  depreciableBasis: number;
  ratePct: number;
  yearDep: number;
  accumulated: number;
  remaining: number; // base ainda a depreciar
  total: number;
  schedule: YearDep[];
}

export interface PtCompanyDep {
  companyId: string;
  companyName: string;
  currency: string;
  yearDep: number;
  accumulated: number;
}

export interface PtAssetRegister {
  year: number;
  years: number[];
  companies: { id: string; legalName: string; baseCurrency: string }[];
  assets: PtAssetView[];
  byCompany: PtCompanyDep[];
}

export async function buildPtAssetRegister(
  year: number,
  companyFilter?: string,
): Promise<PtAssetRegister> {
  const [companies, assets] = await Promise.all([
    prisma.company.findMany({
      where: { jurisdiction: "PT" },
      select: { id: true, legalName: true, baseCurrency: true },
      orderBy: { legalName: "asc" },
    }),
    prisma.fixedAsset.findMany({
      where: { regime: "PT", ...(companyFilter ? { companyId: companyFilter } : {}) },
      include: { company: { select: { legalName: true, baseCurrency: true } } },
      orderBy: { acquisitionDate: "asc" },
    }),
  ]);

  const assetViews: PtAssetView[] = assets.map((a) => {
    const cost = Number(a.cost.toString());
    const landValue = Number(a.landValue.toString());
    const ratePct = Number(a.ratePct.toString());
    const sched = ptDepreciationSchedule({
      cost,
      landValue,
      ratePct,
      acquisitionYear: a.acquisitionDate.getUTCFullYear(),
      acquisitionMonth: a.acquisitionDate.getUTCMonth() + 1,
    });
    const accumulated = ptAccumulatedThrough(sched, year);
    return {
      id: a.id,
      companyId: a.companyId,
      companyName: a.company.legalName,
      currency: a.company.baseCurrency,
      name: a.name,
      category: a.category,
      categoryLabel: ptCategoryByKey(a.category).label,
      acquisitionDate: a.acquisitionDate.toISOString().slice(0, 10),
      cost,
      landValue,
      depreciableBasis: sched.depreciableBasis,
      ratePct,
      yearDep: ptDepreciationForYear(sched, year),
      accumulated,
      remaining: Math.round((sched.depreciableBasis - accumulated) * 100) / 100,
      total: sched.total,
      schedule: sched.schedule,
    };
  });

  const byCompanyMap = new Map<string, PtCompanyDep>();
  for (const v of assetViews) {
    const g = byCompanyMap.get(v.companyId) ?? {
      companyId: v.companyId,
      companyName: v.companyName,
      currency: v.currency,
      yearDep: 0,
      accumulated: 0,
    };
    g.yearDep += v.yearDep;
    g.accumulated += v.accumulated;
    byCompanyMap.set(v.companyId, g);
  }

  const cur = new Date().getUTCFullYear();
  let minY = cur;
  for (const a of assets) minY = Math.min(minY, a.acquisitionDate.getUTCFullYear());
  const years: number[] = [];
  for (let y = cur + 1; y >= minY; y--) years.push(y);

  return {
    year,
    years,
    companies,
    assets: assetViews,
    byCompany: [...byCompanyMap.values()].sort((a, b) => b.yearDep - a.yearDep),
  };
}
