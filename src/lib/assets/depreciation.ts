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
  cost: number;
  recoveryYears: number;
  method: string;
  section179: number;
  bonusPct: number;
  yearDep: number; // depreciação no ano selecionado
  accumulated: number; // acumulada até o ano selecionado
  remaining: number; // base ainda a depreciar
  total: number; // depreciação total (vida toda)
  schedule: YearDep[];
}

export interface CompanyDep {
  companyId: string;
  companyName: string;
  yearDep: number;
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

  const views: AssetView[] = assets.map((a) => {
    const cost = Number(a.cost.toString());
    const sched = depreciationSchedule({
      cost,
      section179: Number(a.section179.toString()),
      bonusPct: Number(a.bonusPct.toString()),
      recoveryYears: Number(a.recoveryYears.toString()),
      method: a.method === "SL_MM" ? "SL_MM" : a.method === "NONE" ? "NONE" : "MACRS",
      acquisitionYear: a.acquisitionDate.getUTCFullYear(),
      acquisitionMonth: a.acquisitionDate.getUTCMonth() + 1,
      // MACRS pura (deveria) ignora os ajustes do livro; o modo padrão (efetivo) os aplica.
      fullyDepreciatedYear: pure ? null : a.fullyDepreciatedYear,
      disposalYear: pure ? null : a.disposalDate ? a.disposalDate.getUTCFullYear() : null,
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
      cost,
      recoveryYears: Number(a.recoveryYears.toString()),
      method: a.method,
      section179: Number(a.section179.toString()),
      bonusPct: Number(a.bonusPct.toString()),
      yearDep: depreciationForYear(sched, year),
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
      accumulated: 0,
    };
    g.yearDep += v.yearDep;
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
