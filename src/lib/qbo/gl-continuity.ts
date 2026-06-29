import { prisma } from "@/lib/db";
import { periodMonths } from "@/lib/qbo/period";

// "Período anterior em aberto" — o sinal mais concreto de que os livros de um ano NÃO estão fechados
// é a descontinuidade de saldos: o SALDO INICIAL do GL do ano Y (contas de balanço) deve bater com o
// SALDO FINAL de Y-1. Se alguém lançou no ano anterior depois de fechado, o beginning de Y muda e não
// fecha. Comparamos beginning(Y) com o ending de Y-1 (preferindo o GL de Y-1; senão o Balance Sheet de
// Y-1). Só contas de balanço têm beginning (P&L zera todo ano), então a checagem é naturalmente sobre
// ativos/passivos/patrimônio. Degrada para "não verificável" quando falta o saldo inicial no GL.

export interface GlContinuityMismatch {
  account: string;
  opening: number; // saldo inicial do GL de Y
  priorEnding: number; // saldo final de Y-1 (GL ou BS)
  diff: number;
}

export type GlContinuityStatus =
  | "no-gl" // sem GL do ano
  | "no-opening" // GL sem saldos iniciais (não dá para checar)
  | "no-prior" // sem referência de Y-1 (GL nem BS)
  | "clean" // checou ≥1 conta e todas batem
  | "mismatch"; // achou descontinuidade → período anterior provavelmente em aberto

export interface GlContinuity {
  companyId: string;
  year: number;
  status: GlContinuityStatus;
  priorRef: "gl" | "bs" | null; // de onde veio o saldo de Y-1
  checkedAccounts: number;
  mismatches: GlContinuityMismatch[];
}

const yearOf = (s: string) => Number((s.match(/(20\d\d)/) ?? [])[0] ?? 0);
const norm = (s: string) =>
  s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const keysOf = (account: string): string[] => {
  const full = norm(account);
  const leaf = norm(account.split(":").pop() ?? account);
  return full === leaf ? [full] : [full, leaf];
};
const num = (v: unknown) => Number((v as { toString(): string } | null)?.toString() ?? 0);

// GL "do ano" = o que começa em janeiro (saldo inicial = abertura do ano). Entre vários, o de maior
// cobertura. Um GL "junho–dezembro" tem beginning de meio de ano → não serve para continuidade.
function pickYearGl<T extends { periodLabel: string }>(gls: T[], year: number): T | null {
  const cands = gls.filter((g) => yearOf(g.periodLabel) === year);
  const janStart = cands.filter((g) => (periodMonths(g.periodLabel)?.start ?? 1) <= 1);
  const pool = janStart.length ? janStart : cands;
  if (!pool.length) return null;
  return pool.reduce((a, b) =>
    (periodMonths(b.periodLabel)?.end ?? 12) > (periodMonths(a.periodLabel)?.end ?? 12) ? b : a,
  );
}

export async function buildGlContinuity(companyId: string, year: number): Promise<GlContinuity> {
  const base = { companyId, year, priorRef: null as "gl" | "bs" | null, checkedAccounts: 0, mismatches: [] as GlContinuityMismatch[] };

  // Âncora pelo GlAccountSummary (tem companyId mesmo quando o QboImport do GL não o tem), agrupando
  // por import para recuperar o período de cada GL.
  type Sum = { account: string; beginning: number | null; ending: number | null };
  const sums = await prisma.glAccountSummary.findMany({
    where: { companyId },
    select: { importId: true, account: true, beginning: true, ending: true, import: { select: { periodLabel: true } } },
  });
  if (!sums.length) return { ...base, status: "no-gl" };
  const byImport = new Map<string, { id: string; periodLabel: string; rows: Sum[] }>();
  for (const s of sums) {
    const g = byImport.get(s.importId) ?? { id: s.importId, periodLabel: s.import?.periodLabel ?? "", rows: [] };
    g.rows.push({ account: s.account, beginning: s.beginning == null ? null : num(s.beginning), ending: s.ending == null ? null : num(s.ending) });
    byImport.set(s.importId, g);
  }
  const imports = [...byImport.values()];
  const yGl = pickYearGl(imports, year);
  if (!yGl) return { ...base, status: "no-gl" };

  const openings = yGl.rows.filter((s) => s.beginning != null);
  if (!openings.length) return { ...base, status: "no-opening" };

  // Referência de Y-1: ending do GL de Y-1; senão ending do Balance Sheet de Y-1.
  const priorEndByKey = new Map<string, number>();
  let priorRef: "gl" | "bs" | null = null;
  const prevGl = pickYearGl(imports, year - 1);
  if (prevGl) {
    for (const s of prevGl.rows) if (s.ending != null) for (const k of keysOf(s.account)) priorEndByKey.set(k, s.ending);
    if (priorEndByKey.size) priorRef = "gl";
  }
  if (!priorRef) {
    const bsImports = await prisma.qboImport.findMany({
      where: { companyId, reportKind: "BALANCE_SHEET" },
      select: { periodLabel: true, lines: { select: { lineType: true, label: true, value: true } } },
      orderBy: { createdAt: "desc" },
    });
    const prevBs = bsImports.find((b) => yearOf(b.periodLabel) === year - 1);
    if (prevBs) {
      for (const l of prevBs.lines)
        if (l.lineType === "ACCOUNT" && l.value != null) for (const k of keysOf(l.label)) priorEndByKey.set(k, num(l.value));
      if (priorEndByKey.size) priorRef = "bs";
    }
  }
  if (!priorRef) return { ...base, status: "no-prior" };

  const mismatches: GlContinuityMismatch[] = [];
  let checked = 0;
  for (const o of openings) {
    let prior: number | undefined;
    for (const k of keysOf(o.account)) if (priorEndByKey.has(k)) { prior = priorEndByKey.get(k); break; }
    if (prior === undefined) continue;
    checked++;
    const opening = num(o.beginning);
    const tol = Math.max(1, 0.01 * Math.abs(prior));
    if (Math.abs(Math.abs(opening) - Math.abs(prior)) > tol)
      mismatches.push({ account: o.account, opening, priorEnding: prior, diff: Math.round((opening - prior) * 100) / 100 });
  }
  if (checked === 0) return { ...base, priorRef, status: "no-prior" };
  mismatches.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
  return { companyId, year, priorRef, checkedAccounts: checked, mismatches, status: mismatches.length ? "mismatch" : "clean" };
}

export interface GlOpenPriorPeriod {
  id: string;
  name: string;
  checkedAccounts: number;
  priorRef: "gl" | "bs";
  topMismatches: GlContinuityMismatch[]; // 3 maiores
  count: number;
}

// Para o reserve: empresas (US monitoradas) cujo GL do ano NÃO fecha com o ano anterior — sinal de
// lançamento em aberto no período anterior. Retorna só as com mismatch (as não verificáveis ficam de
// fora — não há o que afirmar). `unverifiable` conta quantas têm GL mas sem como checar.
export async function buildGlOpenPriorPeriod(
  year: number,
  companyIds: string[],
): Promise<{ flagged: GlOpenPriorPeriod[]; unverifiable: number; checked: number }> {
  const companies = await prisma.company.findMany({
    where: { id: { in: companyIds } },
    select: { id: true, legalName: true },
  });
  const nameById = new Map(companies.map((c) => [c.id, c.legalName]));
  const flagged: GlOpenPriorPeriod[] = [];
  let unverifiable = 0, checked = 0;
  const results = await Promise.all(companyIds.map((id) => buildGlContinuity(id, year)));
  for (const r of results) {
    if (r.status === "no-gl") continue;
    if (r.status === "mismatch" && r.priorRef) {
      checked++;
      flagged.push({
        id: r.companyId,
        name: nameById.get(r.companyId) ?? "—",
        checkedAccounts: r.checkedAccounts,
        priorRef: r.priorRef,
        topMismatches: r.mismatches.slice(0, 3),
        count: r.mismatches.length,
      });
    } else if (r.status === "clean") checked++;
    else unverifiable++; // no-opening / no-prior
  }
  flagged.sort((a, b) => b.count - a.count);
  return { flagged, unverifiable, checked };
}
