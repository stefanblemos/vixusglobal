import { prisma } from "@/lib/db";
import { buildAssetRegister } from "./depreciation";
import { effectiveFiguresOf } from "@/lib/ir/figures";
import { ACTIVE_RETURN } from "@/lib/ir/amendment";

// Compara a depreciação CALCULADA (MACRS, a partir das datas de aquisição) com a
// depreciação reportada no IR (figura DEPRECIATION extraída do retorno) — por empresa/ano.

export interface DepVsIrRow {
  companyId: string;
  name: string;
  computed: number; // depreciação do ano (MACRS)
  accumulated: number; // MACRS acumulada calculada até o ano
  reported: number | null; // depreciação do ano no IR (null = sem IR/sem a figura)
  reportedAccum: number | null; // IR acumulado lançado até o ano (null = nenhum IR com depreciação)
  catchUp: number; // MACRS acumulada − IR acumulado. ATENÇÃO: bate com a Conferência SÓ quando há ativos
  // cadastrados. Quando irWithoutAssets=true, este número é o IR inteiro (MACRS=0) e NÃO é um catch-up
  // de conferência — é o alerta de "cadastre os ativos" (a Conferência mostra 0 por não ter o que conciliar).
  diff: number | null; // calculado − IR (do ano) — referência
  ok: boolean; // catch-up dentro da tolerância
  irWithoutAssets: boolean; // IR tem depreciação mas não há ativos cadastrados (MACRS=0) → cadastrar
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
      where: { companyId: { not: null }, ...ACTIVE_RETURN },
      select: { companyId: true, year: true, figures: true, manualFigures: true },
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
  const lastFiledByCompany = new Map<string, number>(); // último ano com IR de depreciação (≤ ano)
  const allYears = new Set<number>();
  for (const r of returns) {
    if (!r.companyId || r.year == null) continue;
    allYears.add(r.year);
    if (r.year > year) continue;
    const figs = effectiveFiguresOf(r) as Figure[];
    const dep = figs.find((f) => f.key === "DEPRECIATION" && f.value != null);
    const v = dep && dep.value != null ? Math.abs(Number(dep.value)) : null;
    if (r.year === year) hasReturn.add(r.companyId);
    if (v != null) {
      hasAnyIr.add(r.companyId);
      irAccum.set(r.companyId, (irAccum.get(r.companyId) ?? 0) + v);
      if (r.year === year) irDep.set(r.companyId, v);
      const lf = lastFiledByCompany.get(r.companyId);
      if (lf == null || r.year > lf) lastFiledByCompany.set(r.companyId, r.year);
    }
  }

  // Calculado: depreciação do ano + acumulada, por empresa.
  const computedYear = new Map(reg.byCompany.map((b) => [b.companyId, b.yearDep]));
  const accumByCompany = new Map<string, number>(); // MACRS acum até o ANO (projeção completa)
  // MACRS acum até o ÚLTIMO IR de cada empresa — base do catch-up (anos seguintes não declarados
  // ainda não entram, senão a diferença infla comparando projeção × IR congelado).
  const accumFiledByCompany = new Map<string, number>();
  for (const a of reg.assets) {
    accumByCompany.set(a.companyId, (accumByCompany.get(a.companyId) ?? 0) + a.accumulated);
    const lf = lastFiledByCompany.get(a.companyId);
    if (lf != null) {
      const filed = a.schedule.reduce((s, x) => (x.year <= lf ? s + x.amount : s), 0);
      accumFiledByCompany.set(a.companyId, (accumFiledByCompany.get(a.companyId) ?? 0) + filed);
    }
  }
  for (const y of reg.years) allYears.add(y);

  const ids = new Set<string>([...computedYear.keys(), ...accumByCompany.keys(), ...hasAnyIr]);
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const rows: DepVsIrRow[] = [...ids].map((id) => {
    const computed = r2(computedYear.get(id) ?? 0);
    const lf = lastFiledByCompany.get(id);
    // "Computed acum." e o catch-up são medidos até o ÚLTIMO IR declarado (não até o ano da página),
    // para não comparar projeção futura contra IR congelado. Sem nenhum IR → acum até o ano.
    const accumulated = lf != null ? r2(accumFiledByCompany.get(id) ?? 0) : r2(accumByCompany.get(id) ?? 0);
    const reported = irDep.has(id) ? irDep.get(id)! : null;
    const reportedAccum = hasAnyIr.has(id) ? r2(irAccum.get(id) ?? 0) : null;
    const catchUp = r2(accumulated - (reportedAccum ?? 0));
    const diff = reported == null ? null : r2(computed - reported);
    // IR tem depreciação mas não há ativos cadastrados (MACRS=0): não é divergência de conferência,
    // é alerta de cadastro. A Conferência (reconcile-dep) mostra 0 por não ter ativos a conciliar.
    const irWithoutAssets = accumulated <= 0.005 && (reportedAccum ?? 0) > 0.005;
    const ok = irWithoutAssets ? false : Math.abs(catchUp) <= Math.max(1, 0.01 * Math.abs(accumulated || 1));
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
      irWithoutAssets,
      hasReturn: hasReturn.has(id),
    };
  });
  rows.sort((a, b) => Math.abs(b.catchUp) - Math.abs(a.catchUp) || b.accumulated - a.accumulated);

  return { year, rows, years: [...allYears].sort((a, b) => b - a) };
}
