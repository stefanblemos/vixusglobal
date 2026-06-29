import { prisma } from "@/lib/db";
import { periodMonths } from "@/lib/qbo/period";
import { loadClosedResolver } from "@/lib/companies/closed";
import { isEffectiveAt, asOfYearEnd } from "@/lib/ownership/effective";

// Completude dos dados por GRUPO (dono → empresas que entram no número dele). Para o cálculo
// da reserva/fluxo ser preciso, cada empresa do grupo precisa de P&L, BS e GL no ano.

export interface CoCompleteness {
  id: string;
  name: string;
  relationship: string;
  controlled: boolean; // false = não controlamos aqui (outra pessoa controla) → não é "missing"
  pnl: boolean;
  bs: boolean;
  gl: boolean;
  pnlPeriod: string | null; // até quando o P&L vai (YTD): "ano" | "jan–jun" etc.
  bsPeriod: string | null;
  glPeriod: string | null;
}

const MON = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
// Cobertura curta de um período: "ano" (Jan–Dez) ou "jan–jun" (YTD parcial).
const coverageOf = (label: string): string => {
  const pm = periodMonths(label);
  if (!pm) return "ano";
  if (pm.start <= 1 && pm.end >= 12) return "ano";
  return `${MON[Math.max(0, pm.start - 1)]}–${MON[Math.min(11, pm.end - 1)]}`;
};

export interface CoGroup {
  owner: string;
  companies: CoCompleteness[];
  missing: number; // empresas com algo faltando
}

export interface GroupCompleteness {
  year: number;
  groups: CoGroup[];
  totalMissing: number;
}

const yearOf = (s: string) => {
  const m = s.match(/(20\d\d)/);
  return m ? Number(m[1]) : null;
};

export async function buildGroupCompleteness(year: number): Promise<GroupCompleteness> {
  const [companies, imports, ownerships, closedResolver] = await Promise.all([
    prisma.company.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, legalName: true, relationship: true, monitored: true },
    }),
    prisma.qboImport.findMany({
      where: { companyId: { not: null } },
      select: { companyId: true, reportKind: true, periodLabel: true },
    }),
    prisma.ownership.findMany({
      where: { ownedCompanyId: { not: null } },
      select: {
        ownedCompanyId: true,
        effectiveDate: true,
        endDate: true,
        ownerParty: { select: { name: true } },
        ownerCompany: { select: { legalName: true } },
      },
    }),
    loadClosedResolver(),
  ]);

  const nameById = new Map(companies.map((c) => [c.id, c]));
  // Doc de MAIOR cobertura do ano por empresa/tipo → presença + até quando vai (YTD). Assim o "✓"
  // diz o período: "ano" (Jan–Dez) ou "jan–jun" (parcial), em vez de só "tem algum doc do ano".
  const docOf = (companyId: string, kind: string): string | null => {
    const matches = imports.filter(
      (i) => i.companyId === companyId && i.reportKind === kind && yearOf(i.periodLabel) === year,
    );
    if (!matches.length) return null;
    const best = matches.reduce((a, b) =>
      (periodMonths(b.periodLabel)?.end ?? 12) > (periodMonths(a.periodLabel)?.end ?? 12) ? b : a,
    );
    return coverageOf(best.periodLabel);
  };

  const asOf = asOfYearEnd(year);
  const groupsMap = new Map<string, Set<string>>();
  for (const o of ownerships) {
    const owner = o.ownerParty?.name ?? o.ownerCompany?.legalName;
    // Só empresas ATIVAS e NÃO encerradas (fonte única) — encerradas (IR final/closedDate) saem.
    if (!owner || !o.ownedCompanyId || !nameById.has(o.ownedCompanyId)) continue;
    // Dono VIGENTE no ano (fonte única isEffectiveAt) — antes era endDate:null (dono de HOJE), então
    // a completude de um ano histórico usava o dono atual, não o do ano.
    if (!isEffectiveAt(o, asOf)) continue;
    if (closedResolver.isClosedBeforeYear(o.ownedCompanyId, year)) continue;
    (groupsMap.get(owner) ?? groupsMap.set(owner, new Set()).get(owner)!).add(o.ownedCompanyId);
  }

  const groups: CoGroup[] = [...groupsMap.entries()]
    .map(([owner, ids]) => {
      const cos = [...ids]
        .map((id) => {
          const c = nameById.get(id);
          const pnlP = docOf(id, "PROFIT_AND_LOSS");
          const bsP = docOf(id, "BALANCE_SHEET");
          const glP = docOf(id, "GENERAL_LEDGER");
          return {
            id,
            name: c?.legalName ?? "—",
            relationship: c?.relationship ?? "",
            controlled: c?.monitored ?? true,
            pnl: !!pnlP,
            bs: !!bsP,
            gl: !!glP,
            pnlPeriod: pnlP,
            bsPeriod: bsP,
            glPeriod: glP,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
      // Só conta como falta o que É nosso controle; não-controladas são "external".
      const missing = cos.filter((r) => r.controlled && (!r.pnl || !r.bs || !r.gl)).length;
      return { owner, companies: cos, missing };
    })
    .filter((g) => g.companies.length > 0)
    .sort((a, b) => b.missing - a.missing || a.owner.localeCompare(b.owner));

  return { year, groups, totalMissing: groups.reduce((s, g) => s + g.missing, 0) };
}
