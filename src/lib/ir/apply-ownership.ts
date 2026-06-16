import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/qbo/match";
import { entityNames, ownerNameMatches } from "@/lib/ownership/reconcile";
import { Jurisdiction, PartyKind } from "@prisma/client";

type StoredOwner = { name: string; ownershipPct: number | null };

// Nome com cara de pessoa JURÍDICA (p/ não criar como pessoa física por engano).
const COMPANY_SUFFIX =
  /\b(llc|l\.?l\.?c|inc|incorporated|corp|co|ltd|ltda|lp|llp|s\.?a|lda|gmbh|pa|pllc|company|partners?|holdings?|group)\b/i;

/**
 * Cria os vínculos de Ownership a partir dos sócios extraídos de um IR.
 * - Ano TRAVADO (YearClose) → não mexe (a conferência alerta, não troca).
 * - Casa cada sócio com uma EMPRESA cadastrada (nome/alias) → vínculo empresa→empresa;
 *   senão com uma Party; senão, se parece empresa não cadastrada, PULA (registrar antes);
 *   se parece pessoa física, cria a Party.
 * - Carimba pelo ANO do IR; idempotente (pula quem já é dono).
 */
export async function applyOwnershipFromReturn(tr: {
  companyId: string | null;
  year: number | null;
  owners: unknown;
  jurisdiction: string | null;
}): Promise<{ created: number; skipped: string[]; lockedSkipped: boolean }> {
  if (!tr.companyId || !tr.year) return { created: 0, skipped: [], lockedSkipped: false };

  const locked = await prisma.yearClose.findUnique({
    where: { companyId_year: { companyId: tr.companyId, year: tr.year } },
  });
  if (locked) return { created: 0, skipped: [], lockedSkipped: true };

  const owners = ((tr.owners as StoredOwner[] | null) ?? []).filter((o) => o.ownershipPct != null);
  if (owners.length === 0) return { created: 0, skipped: [], lockedSkipped: false };

  const [companies, parties, existing] = await Promise.all([
    prisma.company.findMany({
      select: { id: true, legalName: true, tradeName: true, aliases: true },
    }),
    prisma.party.findMany(),
    prisma.ownership.findMany({ where: { ownedCompanyId: tr.companyId } }),
  ]);
  const jur = (
    ["US", "BR", "PT", "OTHER"].includes(tr.jurisdiction ?? "") ? tr.jurisdiction : "OTHER"
  ) as Jurisdiction;
  const effectiveDate = new Date(`${tr.year}-01-01T00:00:00Z`);

  let created = 0;
  const skipped: string[] = [];
  for (const o of owners) {
    // 1) empresa cadastrada (não pode ser ela mesma)
    const co = companies.find(
      (c) => c.id !== tr.companyId && ownerNameMatches(entityNames(c), o.name),
    );
    if (co) {
      if (existing.some((e) => e.ownerCompanyId === co.id)) continue;
      await prisma.ownership.create({
        data: {
          ownerCompanyId: co.id,
          ownedCompanyId: tr.companyId,
          percentage: o.ownershipPct!,
          effectiveDate,
        },
      });
      created++;
      continue;
    }
    // 2) Party cadastrada
    const pt = parties.find((p) => normalizeName(p.name) === normalizeName(o.name));
    if (pt) {
      if (existing.some((e) => e.ownerPartyId === pt.id)) continue;
      await prisma.ownership.create({
        data: {
          ownerPartyId: pt.id,
          ownedCompanyId: tr.companyId,
          percentage: o.ownershipPct!,
          effectiveDate,
        },
      });
      created++;
      continue;
    }
    // 3) não cadastrado: parece empresa → pula (registrar antes); senão cria pessoa física
    if (COMPANY_SUFFIX.test(o.name)) {
      skipped.push(o.name);
      continue;
    }
    const np = await prisma.party.create({
      data: { name: o.name, kind: PartyKind.PERSON, taxJurisdiction: jur },
    });
    parties.push(np);
    await prisma.ownership.create({
      data: {
        ownerPartyId: np.id,
        ownedCompanyId: tr.companyId,
        percentage: o.ownershipPct!,
        effectiveDate,
      },
    });
    created++;
  }
  return { created, skipped, lockedSkipped: false };
}
