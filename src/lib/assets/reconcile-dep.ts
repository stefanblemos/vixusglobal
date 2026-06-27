import { prisma } from "@/lib/db";
import { buildAssetRegister } from "./depreciation";

// Conferência da depreciação por empresa, ano a ano: o que o MACRS diz que DEVERIA ter sido
// depreciado em cada ano × o que o contador realmente lançou no IR (Form 4562) — e o acumulado
// que falta lançar (catch-up) para alinhar IR e QBO ao cálculo do app.

export type ReconStatus = "ok" | "faltou" | "diferente" | "sem-ir" | "na";

export interface ReconYearRow {
  year: number;
  macrs: number; // depreciação MACRS do ano (deveria)
  macrsAccum: number; // acumulada MACRS até o ano
  ir: number | null; // depreciação lançada no IR do ano (null = sem IR do ano)
  irAccum: number; // IR lançado acumulado até o ano (null vira 0)
  accumDiff: number; // diferença ACUMULADA = MACRS acum − IR acum (>0 = falta lançar)
  status: ReconStatus;
}

export interface DepReconciliation {
  companyId: string;
  companyName: string;
  rows: ReconYearRow[];
  throughYear: number; // último ano fechado considerado (ano corrente − 1)
  macrsAccumThrough: number; // acumulada MACRS que DEVERIA estar lançada até throughYear
  irToDate: number; // soma do que foi lançado no IR (anos com IR)
  irYearsMissing: number[]; // anos com MACRS > 0 sem IR de depreciação na base
  catchUpVsIr: number; // macrsAccumThrough − irToDate
  bsAccum: number | null; // acumulada de depreciação no QBO (Balance Sheet) — referência
  bsLabel: string | null;
  catchUpVsBs: number | null; // macrsAccumThrough − bsAccum
}

const r2 = (n: number) => Math.round(n * 100) / 100;

export async function buildDepreciationReconciliation(companyId: string): Promise<DepReconciliation | null> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { legalName: true } });
  if (!company) return null;

  const currentYear = new Date().getUTCFullYear();
  const throughYear = currentYear - 1;

  // MACRS por ano (soma dos schedules de todos os ativos US da empresa). MACRS PURA (deveria) —
  // ignora "totalmente depreciado"/baixa: o "deveria" é a regra legal do IRS, não o que o livro fez.
  const reg = await buildAssetRegister(currentYear, companyId, { pureMacrs: true });
  const macrsByYear = new Map<number, number>();
  let minYear = currentYear;
  for (const a of reg.assets) {
    for (const y of a.schedule) {
      macrsByYear.set(y.year, (macrsByYear.get(y.year) ?? 0) + y.amount);
      if (y.year < minYear) minYear = y.year;
    }
  }

  // IR lançado por ano (figura DEPRECIATION do retorno).
  const returns = await prisma.taxReturn.findMany({ where: { companyId }, select: { year: true, figures: true } });
  const irByYear = new Map<number, number>();
  for (const ret of returns) {
    if (ret.year == null) continue;
    const figs = (ret.figures as { key?: string; value?: number | null }[] | null) ?? [];
    const d = figs.find((f) => f.key === "DEPRECIATION" && f.value != null);
    if (d && d.value != null) irByYear.set(ret.year, Math.abs(Number(d.value)));
  }

  // Acumulada de depreciação no QBO: escolhe o BS (mais recente por período) que tem linhas de
  // "Accumulated depreciation"; soma-as (valor absoluto).
  const bsImports = await prisma.qboImport.findMany({
    where: { companyId, reportKind: "BALANCE_SHEET" },
    select: { id: true, periodLabel: true },
  });
  let bsAccum: number | null = null;
  let bsLabel: string | null = null;
  if (bsImports.length) {
    const lines = await prisma.qboImportLine.findMany({
      where: { importId: { in: bsImports.map((b) => b.id) }, lineType: "ACCOUNT" },
      select: { importId: true, label: true, value: true },
    });
    const yearOf = (s: string) => Number((s.match(/(19|20)\d\d/) ?? [])[0] ?? 0);
    let best: { id: string; label: string; total: number; year: number } | null = null;
    for (const b of bsImports) {
      const total = lines
        .filter((l) => l.importId === b.id && /accumulated deprecia/i.test(l.label) && l.value != null)
        .reduce((s, l) => s + Math.abs(Number(l.value)), 0);
      const cand = { id: b.id, label: b.periodLabel, total, year: yearOf(b.periodLabel) };
      if (total > 0 && (!best || cand.year > best.year || (cand.year === best.year && cand.total > best.total))) best = cand;
    }
    if (best) {
      bsAccum = r2(best.total);
      bsLabel = best.label;
    }
  }

  // Linhas por ano (do 1º ano de ativo até o corrente).
  const rows: ReconYearRow[] = [];
  let accum = 0;
  let irAccum = 0;
  let irToDate = 0;
  const irYearsMissing: number[] = [];
  for (let y = minYear; y <= currentYear; y++) {
    const macrs = r2(macrsByYear.get(y) ?? 0);
    accum = r2(accum + macrs);
    const ir = irByYear.has(y) ? r2(irByYear.get(y)!) : null;
    irAccum = r2(irAccum + (ir ?? 0));
    const accumDiff = r2(accum - irAccum); // >0 = MACRS à frente (falta lançar/acumular)

    let status: ReconStatus;
    if (macrs <= 0.005) status = "na";
    else if (ir == null) status = "sem-ir";
    else if (ir <= 0.005) status = "faltou";
    else if (Math.abs(macrs - ir) <= Math.max(1, 0.02 * Math.abs(ir))) status = "ok";
    else status = "diferente";

    if (y <= throughYear && macrs > 0.005) {
      if (ir != null) irToDate = r2(irToDate + ir);
      else irYearsMissing.push(y);
    }
    rows.push({ year: y, macrs, macrsAccum: accum, ir, irAccum, accumDiff, status });
  }

  const macrsAccumThrough = r2(rows.filter((r) => r.year <= throughYear).pop()?.macrsAccum ?? 0);

  return {
    companyId,
    companyName: company.legalName,
    rows,
    throughYear,
    macrsAccumThrough,
    irToDate: r2(irToDate),
    irYearsMissing,
    catchUpVsIr: r2(macrsAccumThrough - irToDate),
    bsAccum,
    bsLabel,
    catchUpVsBs: bsAccum == null ? null : r2(macrsAccumThrough - bsAccum),
  };
}
