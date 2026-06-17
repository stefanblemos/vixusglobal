import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/qbo/match";
import { entityNames, ownerNameMatches } from "@/lib/ownership/reconcile";
import { looseNameMatch } from "@/lib/personal/reconcile";
import { Jurisdiction, PartyKind } from "@prisma/client";

type StoredOwner = { name: string; ownershipPct: number | null };
const COMPANY_SUFFIX =
  /\b(llc|l\.?l\.?c|inc|incorporated|corp|co|ltd|ltda|lp|llp|s\.?a|lda|gmbh|pa|pllc|company|partners?|holdings?|group)\b/i;

type Run = { ownerKey: string; pct: number; startY: number; endY: number | null };

/**
 * Reconstrói TODO o ownership de uma empresa a partir dos IRs dela, por ano:
 * - dono no IR do ano = dono naquele ano; quem some depois → ENCERRA;
 * - % que muda no tempo → vira múltiplos períodos;
 * - remove vínculos que não estão em IR nenhum (espúrios);
 * - PRESERVA datas precisas já existentes quando consistentes (não regride dados manuais).
 * Não mexe nos snapshots de YearClose (a conferência segue alertando diferenças).
 * Empresa sem IR fica intocada.
 */
export async function rebuildOwnershipFromIRs(
  companyId: string,
): Promise<{ created: number; removed: number; skipped: string[]; noIrs?: boolean }> {
  const [irs, companies, parties, existing, locks] = await Promise.all([
    prisma.taxReturn.findMany({
      where: { companyId },
      select: { year: true, owners: true, jurisdiction: true },
      orderBy: { year: "asc" },
    }),
    prisma.company.findMany({
      select: { id: true, legalName: true, tradeName: true, aliases: true },
    }),
    prisma.party.findMany(),
    prisma.ownership.findMany({ where: { ownedCompanyId: companyId } }),
    prisma.yearClose.findMany({ where: { companyId }, select: { year: true } }),
  ]);
  const lockedYears = new Set(locks.map((l) => l.year));
  const edgeKey = (e: { ownerCompanyId: string | null; ownerPartyId: string | null }) =>
    `${e.ownerCompanyId ? "company" : "party"}:${e.ownerCompanyId ?? e.ownerPartyId}`;

  const irYears = [...new Set(irs.map((t) => t.year).filter((y): y is number => y != null))].sort(
    (a, b) => a - b,
  );
  if (irYears.length === 0) return { created: 0, removed: 0, skipped: [], noIrs: true };
  const latestY = irYears[irYears.length - 1];
  const jur = (
    ["US", "BR", "PT", "OTHER"].includes(irs[0]?.jurisdiction ?? "")
      ? irs[0]!.jurisdiction
      : "OTHER"
  ) as Jurisdiction;

  // Resolve um nome de sócio → ownerKey ("company:id" | "party:id"), criando Party
  // p/ indivíduo não cadastrado; pulando empresa não cadastrada.
  const skipped = new Set<string>();
  const resolveCache = new Map<string, string | null>();
  const resolve = async (name: string): Promise<string | null> => {
    const norm = normalizeName(name);
    if (resolveCache.has(norm)) return resolveCache.get(norm)!;
    const co = companies.find((c) => c.id !== companyId && ownerNameMatches(entityNames(c), name));
    if (co) {
      resolveCache.set(norm, `company:${co.id}`);
      return `company:${co.id}`;
    }
    // Casa por nome exato OU por prefixo de token ("Fabiola M Lima Lemos" = "Fabiola
    // Miranda Lima Lemos") — evita criar uma party duplicada para a mesma pessoa.
    const pt =
      parties.find((p) => normalizeName(p.name) === norm) ??
      parties.find((p) => p.kind === PartyKind.PERSON && looseNameMatch(name, p.name));
    if (pt) {
      resolveCache.set(norm, `party:${pt.id}`);
      return `party:${pt.id}`;
    }
    if (COMPANY_SUFFIX.test(name)) {
      skipped.add(name);
      resolveCache.set(norm, null);
      return null;
    }
    const np = await prisma.party.create({
      data: { name, kind: PartyKind.PERSON, taxJurisdiction: jur },
    });
    parties.push(np);
    resolveCache.set(norm, `party:${np.id}`);
    return `party:${np.id}`;
  };

  // perYear[year] = Map<ownerKey, pct>. Ano TRAVADO usa o ownership existente (não troca);
  // ano aberto usa os sócios do IR (carregando a última % quando o IR traz % nula).
  const irByYear = new Map(irs.filter((t) => t.year != null).map((t) => [t.year!, t]));
  const perYear = new Map<number, Map<string, number>>();
  const lastPct = new Map<string, number>();
  for (const y of irYears) {
    const m = new Map<string, number>();
    if (lockedYears.has(y)) {
      for (const e of existing) {
        const start = e.effectiveDate?.getUTCFullYear() ?? -Infinity;
        const end = e.endDate?.getUTCFullYear() ?? Infinity;
        if (start <= y && y < end) m.set(edgeKey(e), Number(e.percentage));
      }
    } else {
      const owners = (irByYear.get(y)?.owners as StoredOwner[] | null) ?? [];
      for (const o of owners) {
        const key = await resolve(o.name);
        if (!key) continue;
        let pct = o.ownershipPct ?? lastPct.get(key) ?? null;
        if (pct == null) continue;
        m.set(key, pct);
      }
    }
    for (const [k, v] of m) lastPct.set(k, v);
    perYear.set(y, m);
  }

  // Constrói os períodos (runs) por dono: anos consecutivos (na sequência de IRs) com a mesma %.
  const ownerKeys = new Set<string>();
  for (const m of perYear.values()) for (const k of m.keys()) ownerKeys.add(k);
  const runs: Run[] = [];
  for (const key of ownerKeys) {
    let run: { startY: number; pct: number } | null = null;
    for (const y of irYears) {
      const pct = perYear.get(y)?.get(key);
      if (run && pct === run.pct) continue; // segue
      if (run) {
        runs.push({ ownerKey: key, pct: run.pct, startY: run.startY, endY: y });
        run = null;
      }
      if (pct != null) run = { startY: y, pct };
    }
    if (run) runs.push({ ownerKey: key, pct: run.pct, startY: run.startY, endY: null });
  }

  // Para cada dono, ordena os períodos. A PRESERVAÇÃO de data precisa só vale para:
  // - effectiveDate da PRIMEIRA run (preserva inception/precoce, ex.: 12/12/2017);
  // - endDate da ÚLTIMA run que encerra (preserva a saída precisa, ex.: 07/03/2019).
  // Runs intermediárias (mudança de %) usam o limite anual (não há data exata anual).
  const yStartUTC = (y: number) => new Date(`${y}-01-01T00:00:00Z`);
  const yr = (d: Date | null) => (d ? d.getUTCFullYear() : null);
  const byOwner = new Map<string, Run[]>();
  for (const r of runs) {
    const arr = byOwner.get(r.ownerKey) ?? [];
    arr.push(r);
    byOwner.set(r.ownerKey, arr);
  }
  const desired: { r: Run; effectiveDate: Date | null; endDate: Date | null }[] = [];
  for (const [key, oruns] of byOwner) {
    oruns.sort((a, b) => a.startY - b.startY);
    const mine = existing.filter((e) => edgeKey(e) === key);
    oruns.forEach((r, idx) => {
      const isFirst = idx === 0;
      const isLast = idx === oruns.length - 1;
      let effectiveDate: Date | null;
      if (isFirst) {
        const cands = mine
          .map((e) => e.effectiveDate)
          .filter((d): d is Date => d != null && d.getUTCFullYear() <= r.startY);
        const hasNull = mine.some(
          (e) => e.effectiveDate == null && (yr(e.endDate) ?? 9999) > r.startY,
        );
        effectiveDate = hasNull
          ? null
          : cands.length
            ? cands.reduce((a, b) => (a < b ? a : b))
            : yStartUTC(r.startY);
      } else {
        effectiveDate = yStartUTC(r.startY);
      }
      let endDate: Date | null = null;
      if (r.endY != null) {
        if (isLast) {
          const cands = mine
            .map((e) => e.endDate)
            .filter(
              (d): d is Date => d != null && (yr(d) ?? 0) >= r.startY && (yr(d) ?? 0) <= r.endY!,
            );
          endDate = cands.length ? cands.reduce((a, b) => (a > b ? a : b)) : yStartUTC(r.endY);
        } else {
          endDate = yStartUTC(r.endY);
        }
      }
      desired.push({ r, effectiveDate, endDate });
    });
  }

  // Substitui: apaga os vínculos atuais da empresa e cria o conjunto reconstruído.
  const created = await prisma.$transaction(async (tx) => {
    await tx.ownership.deleteMany({ where: { ownedCompanyId: companyId } });
    for (const d of desired) {
      const [type, oid] = d.r.ownerKey.split(":");
      await tx.ownership.create({
        data: {
          ownedCompanyId: companyId,
          ownerCompanyId: type === "company" ? oid : null,
          ownerPartyId: type === "party" ? oid : null,
          percentage: d.r.pct,
          effectiveDate: d.effectiveDate ?? undefined,
          endDate: d.endDate ?? undefined,
        },
      });
    }
    return desired.length;
  });

  return { created, removed: existing.length, skipped: [...skipped] };
}
