import { normalizeName } from "@/lib/qbo/match";

const nameTokens = (s: string) => normalizeName(s).split(" ").filter(Boolean);

// Casa nomes tolerando a TRUNCAGEM do transcript do IRS — o transcript corta cada parte do
// nome ("S BRAG LEMO" = "Stefan Braga Lemos"). Casa se for igual, ou se tiver o mesmo número
// de tokens e cada token do nome truncado for prefixo do token correspondente do completo.
export function looseNameMatch(a: string, b: string): boolean {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;
  if (ta.join(" ") === tb.join(" ")) return true;
  if (ta.length !== tb.length) return false;
  const [short, full] = ta.join("").length <= tb.join("").length ? [ta, tb] : [tb, ta];
  return short.every((t, i) => full[i].startsWith(t));
}

// Cruzamento entidade → pessoa física: cada K-1 que as LLCs alocaram ao contribuinte
// (e ao cônjuge, numa declaração conjunta) deveria aparecer no Schedule E do 1040 dele.
// Compara a soma das alocações (como declarada pelas entidades) com o que o 1040 reportou.

export type EntityAllocation = {
  entityId: string;
  entityName: string;
  year: number | null;
  ownerName: string; // nome do sócio como consta no IR da entidade
  allocated: number; // renda alocada (negativa = perda)
};

// Participação numa C-Corp do sócio: a renda NÃO passa para o 1040 (a entidade paga o
// 1120); o sócio só é tributado em dividendos. Mostrada à parte, não na soma de K-1.
export type CCorpHolding = { entityId: string; entityName: string; year: number | null };

export type PersonalCrossCheck = {
  names: string[]; // contribuinte + cônjuge
  contributions: EntityAllocation[]; // alocações pass-through que deveriam estar no 1040
  expectedTotal: number; // soma das alocações das entidades (pass-through)
  reportedNet: number | null; // partnershipIncome − partnershipLoss do 1040
  gap: number | null; // reportedNet − expectedTotal
  status: "match" | "diff" | "noData";
  cCorpHoldings: CCorpHolding[]; // entidades C-Corp do sócio (renda fica na entidade)
  dividendsReported: number | null; // dividendos no 1040 (1099-DIV das C-Corps, etc.)
};

type EntityReturn = {
  companyId: string | null;
  year: number | null;
  taxTreatment: string | null;
  owners: { name: string; allocatedIncome: number | null }[] | null;
};

// Soma, por ano, o que cada entidade alocou ao contribuinte/cônjuge.
export function entityAllocationsForPerson(
  names: string[],
  year: number | null,
  returns: EntityReturn[],
  companyNameById: Map<string, string>,
): EntityAllocation[] {
  const wanted = names.filter((n) => !!n && !!n.trim());
  if (wanted.length === 0) return [];
  const out: EntityAllocation[] = [];
  for (const r of returns) {
    if (!r.companyId || (year != null && r.year !== year)) continue;
    for (const o of r.owners ?? []) {
      if (o.allocatedIncome == null) continue;
      if (!wanted.some((n) => looseNameMatch(n, o.name))) continue;
      out.push({
        entityId: r.companyId,
        entityName: companyNameById.get(r.companyId) ?? r.companyId,
        year: r.year,
        ownerName: o.name,
        allocated: o.allocatedIncome,
      });
    }
  }
  return out;
}

export function crossCheckPersonalReturn(
  personal: {
    matchedName: string | null;
    spouseName: string | null;
    year: number | null;
    partnershipIncome: number | null;
    partnershipLoss: number | null;
    ordinaryDividends?: number | null;
  },
  returns: EntityReturn[],
  companyNameById: Map<string, string>,
): PersonalCrossCheck {
  const names = [personal.matchedName, personal.spouseName].filter(
    (n): n is string => !!n && !!n.trim(),
  );
  const contributions = entityAllocationsForPerson(
    names,
    personal.year,
    returns,
    companyNameById,
  ).sort((a, b) => a.entityName.localeCompare(b.entityName));

  // C-Corp holdings: entidades C-Corp em que o sócio aparece (a renda fica na entidade —
  // 1120; o sócio só é tributado em dividendos, então NÃO entra na soma de K-1 esperada).
  const cCorpHoldings: CCorpHolding[] = [];
  const want = names.filter((n) => !!n && !!n.trim());
  for (const r of returns) {
    if (!r.companyId || (personal.year != null && r.year !== personal.year)) continue;
    if (r.taxTreatment !== "C_CORP") continue;
    if (!(r.owners ?? []).some((o) => want.some((n) => looseNameMatch(n, o.name)))) continue;
    const id = r.companyId;
    if (cCorpHoldings.some((h) => h.entityId === id)) continue;
    cCorpHoldings.push({ entityId: id, entityName: companyNameById.get(id) ?? id, year: r.year });
  }

  const expectedTotal = contributions.reduce((s, c) => s + c.allocated, 0);
  const reportedNet =
    personal.partnershipIncome == null && personal.partnershipLoss == null
      ? null
      : (personal.partnershipIncome ?? 0) - (personal.partnershipLoss ?? 0);

  const gap = reportedNet == null ? null : reportedNet - expectedTotal;
  let status: PersonalCrossCheck["status"];
  if (contributions.length === 0 && reportedNet == null) status = "noData";
  else if (gap == null) status = "noData";
  else status = Math.abs(gap) <= Math.max(1, Math.abs(expectedTotal) * 0.02) ? "match" : "diff";

  return {
    names,
    contributions,
    expectedTotal,
    reportedNet,
    gap,
    status,
    cCorpHoldings,
    dividendsReported: personal.ordinaryDividends ?? null,
  };
}
