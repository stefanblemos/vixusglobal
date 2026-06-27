import { prisma } from "@/lib/db";
import { buildAssetRegister } from "./depreciation";

// Compara a depreciação CALCULADA (MACRS, a partir das datas de aquisição) com a
// depreciação reportada no IR (figura DEPRECIATION extraída do retorno) — por empresa/ano.

export interface DepVsIrRow {
  companyId: string;
  name: string;
  computed: number; // depreciação do ano (MACRS)
  accumulated: number; // MACRS acumulada calculada até o ano
  reported: number | null; // depreciação do ano no IR (null = sem IR/sem a figura)
  reportedAccum: number | null; // IR acumulado lançado até o ano (null = nenhum IR com depreciação)
  catchUp: number; // MACRS acumulada − IR acumulado (o que ainda falta lançar) — bate com a Conferência
  diff: number | null; // calculado − IR (do ano) — referência
  ok: boolean; // catch-up dentro da tolerância
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
    buildAssetRegister(year, undefined, { pureMacrs: true }), // "Computed (MACRS)" = MACRS legal pura
    prisma.taxReturn.findMany({
      where: { companyId: { not: null } },
      select: { companyId: true, year: true, figures: true },
    }),
    prisma.company.findMany({ select: { id: true, legalName: true } }),
  ]);

  const nameById = new Map(companies.map((c) => [c.id, c.legalName]));

  // Depreciação reportada no IR: do ANO (irDep) e ACUMULADA até o ano (irAccum, soma dos IRs ≤ ano).
  // O acumulado é o que "conversa" com a Conferência — o catch-up é MACRS acum − IR acum.
  const irDep = new Map<string, number>();
  const irAccum = new Map<string, number>();
  const hasReturn = new Set<string>(); // tem IR do ano selecionado
  const hasAnyIr = new Set<string>(); // tem algum IR (≤ ano) com figura de depreciação
  const allYears = new Set<number>();
  for (const r of returns) {
    if (!r.companyId || r.year == null) continue;
    allYears.add(r.year);
    if (r.year > year) continue;
    const figs = (r.figures as Figure[] | null) ?? [];
    const dep = figs.find((f) => f.key === "DEPRECIATION" && f.value != null);
    const v = dep && dep.value != null ? Math.abs(Number(dep.value)) : null;
    if (r.year === year) hasReturn.add(r.companyId);
    if (v != null) {
      hasAnyIr.add(r.companyId);
      irAccum.set(r.companyId, (irAccum.get(r.companyId) ?? 0) + v);
      if (r.year === year) irDep.set(r.companyId, v);
    }
  }

  // Calculado: depreciação do ano + acumulada, por empresa.
  const computedYear = new Map(reg.byCompany.map((b) => [b.companyId, b.yearDep]));
  const accumByCompany = new Map<string, number>();
  for (const a of reg.assets) {
    accumByCompany.set(a.companyId, (accumByCompany.get(a.companyId) ?? 0) + a.accumulated);
  }
  for (const y of reg.years) allYears.add(y);

  const ids = new Set<string>([...computedYear.keys(), ...accumByCompany.keys(), ...hasAnyIr]);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rows: DepVsIrRow[] = [...ids].map((id) => {
    const computed = r2(computedYear.get(id) ?? 0);
    const accumulated = r2(accumByCompany.get(id) ?? 0);
    const reported = irDep.has(id) ? irDep.get(id)! : null;
    const reportedAccum = hasAnyIr.has(id) ? r2(irAccum.get(id) ?? 0) : null;
    // Catch-up acumulado: MACRS acumulada − IR acumulado (anos sem IR contam 0) — = Conferência.
    const catchUp = r2(accumulated - (reportedAccum ?? 0));
    const diff = reported == null ? null : r2(computed - reported);
    const ok = Math.abs(catchUp) <= Math.max(1, 0.01 * Math.abs(accumulated || 1));
    return {
      companyId: id,
      name: nameById.get(id) ?? "—",
      computed,
      accumulated,
      reported,
      reportedAccum,
      catchUp,
      diff,
      ok,
      hasReturn: hasReturn.has(id),
    };
  });
  rows.sort((a, b) => Math.abs(b.catchUp) - Math.abs(a.catchUp) || b.accumulated - a.accumulated);

  return { year, rows, years: [...allYears].sort((a, b) => b - a) };
}
