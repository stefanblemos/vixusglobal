import { prisma } from "@/lib/db";
import { buildCompleteness } from "@/lib/closing/completeness";
import { buildBankReconSummary } from "@/lib/bank/summary";
import { computeLoanBalance } from "@/lib/loans/interest";
import { obligationsFor } from "@/lib/obligations/rules";

// Monta o painel do Overview: atenção, progresso do fechamento, exposição intercompany
// e mapa de calor — tudo restrito às empresas monitoradas (flag `monitored`).

const COL_KEYS = ["ir", "pnl", "bs", "gl", "bank"] as const;
const COL_LABELS: Record<string, string> = {
  ir: "IR",
  pnl: "P&L",
  bs: "BS",
  gl: "GL",
  bank: "Bank",
};

const MON: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

// Resolve o próximo vencimento futuro a partir do rótulo legível ("May 1", "Apr 15 · Jun 15 …").
function nextDue(due: string, today: Date): Date | null {
  const re = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})\b/g;
  let best: number | null = null;
  const ty = today.getUTCFullYear();
  for (const m of due.toLowerCase().matchAll(re)) {
    const mo = MON[m[1]];
    const day = Number(m[2]);
    let t = Date.UTC(ty, mo, day);
    if (t < today.getTime()) t = Date.UTC(ty + 1, mo, day);
    if (best == null || t < best) best = t;
  }
  return best == null ? null : new Date(best);
}

export interface OverviewData {
  year: number;
  years: number[];
  counts: { companies: number; owners: number; loans: number };
  closing: {
    complete: number;
    existing: number;
    pct: number;
    byCol: { key: string; label: string; ok: number; total: number }[];
  };
  bank: { flagged: number; toReview: number; outOfBalance: number };
  docsMissing: number;
  obligations: {
    within30: number;
    next: { date: string; name: string; company: string } | null;
  };
  exposure: {
    loans: { lender: string; borrower: string; currency: string; principal: number }[];
    totalsByCurrency: { currency: string; principal: number }[];
  };
  heatmap: {
    id: string;
    name: string;
    state: "complete" | "partial" | "empty";
    complete: number;
    total: number;
  }[];
}

export async function buildOverview(): Promise<OverviewData> {
  const today = new Date();
  const currentYear = today.getUTCFullYear();

  const probe = await buildCompleteness(currentYear - 1);
  const years = probe.years.length > 0 ? probe.years : [currentYear - 1];
  const year = years.includes(currentYear - 1) ? currentYear - 1 : years[0];
  const { rows } = year === currentYear - 1 ? probe : await buildCompleteness(year);

  const existing = rows.filter((r) => r.existed);
  const complete = existing.filter((r) => r.complete === COL_KEYS.length).length;
  const byCol = COL_KEYS.map((k) => ({
    key: k,
    label: COL_LABELS[k],
    ok: existing.filter((r) => r[k].ok).length,
    total: existing.length,
  }));
  const docsMissing = existing.filter((r) => r.complete === 0).length;

  const heatmap = rows.map((r) => ({
    id: r.companyId,
    name: r.companyName,
    state: !r.existed
      ? ("empty" as const) // tratado à parte na UI via total=0
      : r.complete === COL_KEYS.length
        ? ("complete" as const)
        : r.complete === 0
          ? ("empty" as const)
          : ("partial" as const),
    complete: r.complete,
    total: r.existed ? COL_KEYS.length : 0,
  }));

  // ── Banco ──
  const [flagged, toReview, statements] = await Promise.all([
    prisma.bankStatementLine.count({ where: { status: "FLAGGED" } }),
    prisma.bankStatementLine.count({ where: { status: "UNREVIEWED" } }),
    prisma.bankStatement.findMany({ select: { id: true, glAccount: true } }),
  ]);
  let outOfBalance = 0;
  for (const s of statements) {
    if (!s.glAccount) continue;
    const sum = await buildBankReconSummary(prisma, s.id);
    if (sum && Math.abs(sum.difference) >= 0.005) outOfBalance += 1;
  }

  // ── Obrigações (próximo vencimento entre as empresas monitoradas) ──
  const [oblCompanies, returns, ownerships, parties] = await Promise.all([
    prisma.company.findMany({
      where: { status: "ACTIVE", monitored: true },
      select: {
        id: true, legalName: true, jurisdiction: true, state: true,
        collectsSalesTax: true, hasEmployees: true,
      },
    }),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null }, taxTreatment: { not: null } },
      select: { companyId: true, taxTreatment: true, year: true },
      orderBy: { year: "desc" },
    }),
    prisma.ownership.findMany({
      where: { ownerPartyId: { not: null }, ownedCompanyId: { not: null } },
      select: { ownedCompanyId: true, ownerPartyId: true },
    }),
    prisma.party.findMany({ select: { id: true, taxJurisdiction: true } }),
  ]);
  const treatmentByCompany = new Map<string, string>();
  for (const r of returns) {
    if (r.companyId && !treatmentByCompany.has(r.companyId)) {
      treatmentByCompany.set(r.companyId, r.taxTreatment ?? "");
    }
  }
  const foreignPartyIds = new Set(
    parties.filter((p) => p.taxJurisdiction && p.taxJurisdiction !== "US").map((p) => p.id),
  );
  const foreignByCompany = new Set<string>();
  for (const o of ownerships) {
    if (o.ownedCompanyId && o.ownerPartyId && foreignPartyIds.has(o.ownerPartyId)) {
      foreignByCompany.add(o.ownedCompanyId);
    }
  }
  const in30 = today.getTime() + 30 * 86_400_000;
  let within30 = 0;
  let next: { date: string; name: string; company: string } | null = null;
  let nextTs = Infinity;
  for (const c of oblCompanies) {
    const obls = obligationsFor({
      jurisdiction: c.jurisdiction,
      state: c.state,
      taxTreatment: treatmentByCompany.get(c.id) ?? null,
      collectsSalesTax: c.collectsSalesTax,
      hasEmployees: c.hasEmployees,
      hasForeignPartners: foreignByCompany.has(c.id),
    });
    for (const o of obls) {
      if (o.applies !== "yes") continue;
      const d = nextDue(o.due, today);
      if (!d) continue;
      if (d.getTime() <= in30) within30 += 1;
      if (d.getTime() < nextTs) {
        nextTs = d.getTime();
        next = { date: d.toISOString().slice(0, 10), name: o.name, company: c.legalName };
      }
    }
  }

  // ── Exposição intercompany ──
  const loans = await prisma.intercompanyLoan.findMany({
    include: { lender: true, borrower: true, transactions: true },
  });
  const expLoans = loans
    .map((loan) => {
      const bal = computeLoanBalance(
        {
          annualInterestRate: loan.annualInterestRate.toString(),
          dayCountBasis: loan.dayCountBasis,
          startDate: loan.startDate,
        },
        loan.transactions.map((t) => ({
          type: t.type,
          amount: t.amount.toString(),
          date: t.date,
        })),
        today,
      );
      return {
        lender: loan.lender.legalName,
        borrower: loan.borrower.legalName,
        currency: loan.currency,
        principal: Number(bal.principalOutstanding),
      };
    })
    .sort((a, b) => b.principal - a.principal);
  const totalsMap = new Map<string, number>();
  for (const l of expLoans) totalsMap.set(l.currency, (totalsMap.get(l.currency) ?? 0) + l.principal);
  const totalsByCurrency = [...totalsMap.entries()].map(([currency, principal]) => ({
    currency,
    principal,
  }));

  const [companiesCount, ownersCount] = await Promise.all([
    prisma.company.count({ where: { monitored: true } }),
    prisma.party.count(),
  ]);

  return {
    year,
    years,
    counts: { companies: companiesCount, owners: ownersCount, loans: loans.length },
    closing: { complete, existing: existing.length, pct: existing.length ? Math.round((complete / existing.length) * 100) : 0, byCol },
    bank: { flagged, toReview, outOfBalance },
    docsMissing,
    obligations: { within30, next },
    exposure: { loans: expLoans, totalsByCurrency },
    heatmap,
  };
}
