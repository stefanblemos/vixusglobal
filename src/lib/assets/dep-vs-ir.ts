import { prisma } from "@/lib/db";
import { buildAssetRegister } from "./depreciation";

// Compara a depreciação CALCULADA (MACRS, a partir das datas de aquisição) com a
// depreciação reportada no IR (figura DEPRECIATION extraída do retorno) — por empresa/ano.

export interface DepVsIrRow {
  companyId: string;
  name: string;
  computed: number; // depreciação do ano (MACRS)
  accumulated: number; // acumulada calculada até o ano
  reported: number | null; // depreciação do ano no IR (null = sem IR/sem a figura)
  diff: number | null; // calculado − IR
  ok: boolean; // bate dentro da tolerância
  hasReturn: boolean; // existe IR do ano?
}

export interface DepVsIr {
  year: number;
  rows: DepVsIrRow[];
  years: number[]; // anos com ativos OU com IR (para o seletor)
}

type Figure = { key?: string; value?: number | null };

export async function buildDepreciationVsIR(year: number): Promise<DepVsIr> {
  const [reg, returns, companies] = await Promise.all([
    buildAssetRegister(year),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null } },
      select: { companyId: true, year: true, figures: true },
    }),
    prisma.company.findMany({ select: { id: true, legalName: true } }),
  ]);

  const nameById = new Map(companies.map((c) => [c.id, c.legalName]));

  // Depreciação reportada no IR do ano, por empresa.
  const irDep = new Map<string, number>();
  const hasReturn = new Set<string>();
  const allYears = new Set<number>();
  for (const r of returns) {
    if (!r.companyId || r.year == null) continue;
    allYears.add(r.year);
    if (r.year !== year) continue;
    hasReturn.add(r.companyId);
    const figs = (r.figures as Figure[] | null) ?? [];
    const dep = figs.find((f) => f.key === "DEPRECIATION" && f.value != null);
    if (dep && dep.value != null) irDep.set(r.companyId, Math.abs(Number(dep.value)));
  }

  // Calculado: depreciação do ano + acumulada, por empresa.
  const computedYear = new Map(reg.byCompany.map((b) => [b.companyId, b.yearDep]));
  const accumByCompany = new Map<string, number>();
  for (const a of reg.assets) {
    accumByCompany.set(a.companyId, (accumByCompany.get(a.companyId) ?? 0) + a.accumulated);
  }
  for (const y of reg.years) allYears.add(y);

  const ids = new Set<string>([...computedYear.keys(), ...irDep.keys()]);
  const rows: DepVsIrRow[] = [...ids].map((id) => {
    const computed = Math.round((computedYear.get(id) ?? 0) * 100) / 100;
    const accumulated = Math.round((accumByCompany.get(id) ?? 0) * 100) / 100;
    const reported = irDep.has(id) ? irDep.get(id)! : null;
    const diff = reported == null ? null : Math.round((computed - reported) * 100) / 100;
    const ok = reported == null ? false : Math.abs(computed - reported) <= Math.max(1, 0.01 * Math.abs(reported));
    return {
      companyId: id,
      name: nameById.get(id) ?? "—",
      computed,
      accumulated,
      reported,
      diff,
      ok,
      hasReturn: hasReturn.has(id),
    };
  });
  rows.sort((a, b) => Math.abs(b.diff ?? -1) - Math.abs(a.diff ?? -1) || b.computed - a.computed);

  return { year, rows, years: [...allYears].sort((a, b) => b - a) };
}
