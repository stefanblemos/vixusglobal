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

export type PersonalCrossCheck = {
  names: string[]; // contribuinte + cônjuge
  contributions: EntityAllocation[]; // alocações que deveriam estar no 1040
  expectedTotal: number; // soma das alocações das entidades
  reportedNet: number | null; // partnershipIncome − partnershipLoss do 1040
  gap: number | null; // reportedNet − expectedTotal
  status: "match" | "diff" | "noData";
};

type EntityReturn = {
  companyId: string | null;
  year: number | null;
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

  return { names, contributions, expectedTotal, reportedNet, gap, status };
}
