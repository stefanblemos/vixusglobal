import { prisma } from "@/lib/db";

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
}

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
  const [companies, imports, ownerships] = await Promise.all([
    prisma.company.findMany({
      where: { status: "ACTIVE" },
      select: { id: true, legalName: true, relationship: true, monitored: true },
    }),
    prisma.qboImport.findMany({
      where: { companyId: { not: null } },
      select: { companyId: true, reportKind: true, periodLabel: true },
    }),
    prisma.ownership.findMany({
      where: { ownedCompanyId: { not: null }, endDate: null },
      select: {
        ownedCompanyId: true,
        ownerParty: { select: { name: true } },
        ownerCompany: { select: { legalName: true } },
      },
    }),
  ]);

  const nameById = new Map(companies.map((c) => [c.id, c]));
  const has = (companyId: string, kind: string) =>
    imports.some(
      (i) => i.companyId === companyId && i.reportKind === kind && yearOf(i.periodLabel) === year,
    );

  const groupsMap = new Map<string, Set<string>>();
  for (const o of ownerships) {
    const owner = o.ownerParty?.name ?? o.ownerCompany?.legalName;
    // Só empresas ATIVAS (estão no nameById); inativas/encerradas não entram no check.
    if (!owner || !o.ownedCompanyId || !nameById.has(o.ownedCompanyId)) continue;
    (groupsMap.get(owner) ?? groupsMap.set(owner, new Set()).get(owner)!).add(o.ownedCompanyId);
  }

  const groups: CoGroup[] = [...groupsMap.entries()]
    .map(([owner, ids]) => {
      const cos = [...ids]
        .map((id) => {
          const c = nameById.get(id);
          return {
            id,
            name: c?.legalName ?? "—",
            relationship: c?.relationship ?? "",
            controlled: c?.monitored ?? true,
            pnl: has(id, "PROFIT_AND_LOSS"),
            bs: has(id, "BALANCE_SHEET"),
            gl: has(id, "GENERAL_LEDGER"),
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
