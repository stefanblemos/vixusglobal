import { prisma } from "@/lib/db";
import { normalizeName } from "@/lib/qbo/match";
import { effectiveFiguresOf } from "@/lib/ir/figures";
import { pickExactTreatment } from "@/lib/tax/treatment";

// Números-chave do IR que entram no snapshot (comparáveis entre reenvios).
const SNAPSHOT_FIGURE_KEYS = [
  "GROSS_RECEIPTS",
  "COST_OF_GOODS",
  "OTHER_INCOME",
  "TOTAL_INCOME",
  "ORDINARY_INCOME",
  "TOTAL_DEDUCTIONS",
  "DEPRECIATION",
  "TAXABLE_INCOME",
  "NET_INCOME",
  "NON_DEDUCTIBLE",
  "TOTAL_TAX",
] as const;

export type SnapshotFigure = { key: string; label: string; value: number | null };
export type SnapshotOwner = { name: string; pct: number | null; role: string | null };
export type YearSnapshot = {
  owners: SnapshotOwner[];
  taxTreatment: string | null;
  entityType: string | null;
  taxForm: string | null;
  figures: SnapshotFigure[];
};

type Figure = { key: string; label: string; value: number | null };
type Owner = { name: string; ownershipPct: number | null; role: string | null };

// Donos registrados vigentes no ano (Ownership com effective/end carimbando o ano).
async function registeredOwnersAsOf(companyId: string, year: number): Promise<SnapshotOwner[]> {
  const start = new Date(`${year}-01-01T00:00:00Z`);
  const end = new Date(`${year}-12-31T23:59:59Z`);
  const [ownerships, parties, companies] = await Promise.all([
    prisma.ownership.findMany({
      where: {
        ownedCompanyId: companyId,
        effectiveDate: { lte: end },
        OR: [{ endDate: null }, { endDate: { gte: start } }],
      },
    }),
    prisma.party.findMany(),
    prisma.company.findMany(),
  ]);
  const partyById = new Map(parties.map((p) => [p.id, p.name]));
  const companyById = new Map(companies.map((c) => [c.id, c.legalName]));
  const result: SnapshotOwner[] = [];
  for (const o of ownerships) {
    const name = o.ownerPartyId
      ? partyById.get(o.ownerPartyId)
      : companyById.get(o.ownerCompanyId ?? "");
    if (name) result.push({ name, pct: Number(o.percentage), role: null });
  }
  return result;
}

// Monta a "verdade de referência" do ano a partir do que está cadastrado/declarado.
export async function buildYearSnapshot(companyId: string, year: number): Promise<YearSnapshot> {
  const [taxStatus, latestIr, owners] = await Promise.all([
    prisma.companyTaxStatus.findFirst({ where: { companyId, year } }),
    prisma.taxReturn.findFirst({
      where: { companyId, year },
      orderBy: { createdAt: "desc" },
      omit: { pdf: true },
    }),
    registeredOwnersAsOf(companyId, year),
  ]);

  const irFigures = latestIr ? (effectiveFiguresOf(latestIr) as Figure[]) : [];
  const figVal = (k: string) => irFigures.find((f) => f.key === k);
  const figures: SnapshotFigure[] = SNAPSHOT_FIGURE_KEYS.map((k) => {
    const f = figVal(k);
    return { key: k, label: f?.label ?? k, value: f?.value ?? null };
  }).filter((f) => f.value != null);

  // Se não houver ownership cadastrado no ano, cai para os sócios do próprio IR.
  const irOwners = ((latestIr?.owners as Owner[] | null) ?? []).map((o) => ({
    name: o.name,
    pct: o.ownershipPct,
    role: o.role,
  }));

  return {
    owners: owners.length > 0 ? owners : irOwners,
    taxTreatment: pickExactTreatment(taxStatus?.taxTreatment ?? null, latestIr?.taxTreatment ?? null).treatment,
    entityType: (taxStatus?.entityType as string | undefined) ?? latestIr?.entityType ?? null,
    taxForm: latestIr?.taxForm ?? null,
    figures,
  };
}

export type YearAlert = {
  field: string;
  message: string;
  expected: string;
  got: string;
};

const fmt = (v: number | null | undefined) =>
  v == null ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(v);

// Compara a verdade travada com o IR atualmente arquivado → divergências = alertas.
export function detectYearAlerts(
  snapshot: YearSnapshot,
  ir: {
    taxForm: string | null;
    taxTreatment: string | null;
    entityType: string | null;
    figures: Figure[];
    owners: Owner[];
  } | null,
): YearAlert[] {
  if (!ir) return [];
  const alerts: YearAlert[] = [];

  // Forma de tributação / formulário.
  if (snapshot.taxTreatment && ir.taxTreatment && snapshot.taxTreatment !== ir.taxTreatment) {
    alerts.push({
      field: "Tax treatment",
      message: "The filed return changed the tax treatment for a locked year.",
      expected: snapshot.taxTreatment,
      got: ir.taxTreatment,
    });
  }
  if (snapshot.taxForm && ir.taxForm && snapshot.taxForm !== ir.taxForm) {
    alerts.push({
      field: "Tax form",
      message: "The filed return uses a different form than the locked one.",
      expected: snapshot.taxForm,
      got: ir.taxForm,
    });
  }

  // Sócios: cada dono travado deve aparecer no IR com a mesma %.
  const irOwners = ir.owners ?? [];
  for (const o of snapshot.owners) {
    const hit = irOwners.find((x) => normalizeName(x.name) === normalizeName(o.name));
    if (!hit) {
      alerts.push({
        field: `Partner — ${o.name}`,
        message: "A locked partner is not on the filed return.",
        expected: o.pct != null ? `${o.pct}%` : "registered",
        got: "absent",
      });
    } else if (
      o.pct != null &&
      hit.ownershipPct != null &&
      Math.abs(o.pct - hit.ownershipPct) > 0.5
    ) {
      alerts.push({
        field: `Partner — ${o.name}`,
        message: "Ownership % on the filed return differs from the locked structure.",
        expected: `${o.pct}%`,
        got: `${hit.ownershipPct}%`,
      });
    }
  }
  // Sócio no IR que não está na estrutura travada.
  for (const x of irOwners) {
    if (!snapshot.owners.some((o) => normalizeName(o.name) === normalizeName(x.name))) {
      alerts.push({
        field: `Partner — ${x.name}`,
        message: "The filed return lists a partner not in the locked structure.",
        expected: "absent",
        got: x.ownershipPct != null ? `${x.ownershipPct}%` : "present",
      });
    }
  }

  // Números-chave: tolerância 1% ou $1.
  const figVal = (k: string) => ir.figures.find((f) => f.key === k)?.value ?? null;
  for (const f of snapshot.figures) {
    if (f.value == null) continue;
    const now = figVal(f.key);
    if (now == null) continue;
    const tol = Math.max(1, Math.abs(f.value) * 0.01);
    if (Math.abs(now - f.value) > tol) {
      alerts.push({
        field: f.label,
        message: "A key figure on the filed return changed from the locked value.",
        expected: fmt(f.value),
        got: fmt(now),
      });
    }
  }

  return alerts;
}
