import { prisma } from "@/lib/db";
import { pnlTotals } from "@/lib/qbo/pnl";
import { periodMonths } from "@/lib/qbo/period";
import { buildAssetRegister } from "@/lib/assets/depreciation";
import { bookDepFromLines, trustBookDepAdjustment } from "@/lib/assets/book-tax-dep";
import { computeLoanBalance } from "@/lib/loans/interest";
import { yearRates, classRate } from "./reserve";
import { buildTreatmentResolver } from "@/lib/tax/treatment";

// Demonstração TRIMESTRAL por componentes da base tributável, por empresa:
//   lucro do período + juros a receber − juros a pagar − depreciação ± K-1 = base → tax.
// Avisa quando falta insumo para fechar a base.

export interface QComp {
  profit: number | null; // null = lucro do trimestre desconhecido (P&L anual)
  interestIn: number; // juros a receber (credor)
  interestOut: number; // juros a pagar (tomador)
  depreciation: number; // MACRS do período
  k1: number; // resultado vindo de investidas (±)
  base: number | null; // null quando o lucro do trimestre é desconhecido
  tax: number | null;
}

// Contribuição de cada investida (pass-through) ao K-1 — aberto por empresa.
export interface K1Item {
  name: string;
  quarters: number[]; // Q1..Q4
  fy: number;
}

export interface QBreakdownRow {
  companyId: string;
  name: string;
  currency: string;
  ratePct: number;
  annualOnly: boolean; // lucro só anual (badge); juros/dep/K-1 ainda saem por trimestre
  quarters: QComp[]; // Q1..Q4 (sempre)
  fy: QComp;
  k1Items: K1Item[]; // K-1 aberto por investida
  missing: string[]; // insumos faltando para fechar a base
}

const yearOfLabel = (s: string) => {
  const m = s.match(/(20\d\d)/);
  return m ? Number(m[1]) : null;
};
const r2 = (n: number) => Math.round(n * 100) / 100;
const quarterOf = (m: number) => Math.ceil(m / 3);

async function netIncomeOf(importId: string): Promise<number | null> {
  const lines = await prisma.qboImportLine.findMany({ where: { importId, lineType: "TOTAL" } });
  return pnlTotals(lines).netIncome;
}

export async function buildQuarterlyBreakdown(year: number): Promise<{ rows: QBreakdownRow[] }> {
  const [companies, pnls, returns, loans, assetReg, ownerships, overrideRows, yr, taxStatuses] =
    await Promise.all([
      prisma.company.findMany({
        where: { baseCurrency: "USD" },
        select: { id: true, legalName: true, baseCurrency: true },
      }),
      prisma.qboImport.findMany({
        where: { reportKind: "PROFIT_AND_LOSS", companyId: { not: null } },
        select: { id: true, companyId: true, periodLabel: true },
      }),
      prisma.taxReturn.findMany({
        where: { companyId: { not: null }, taxTreatment: { not: null } },
        select: { companyId: true, taxTreatment: true, year: true, createdAt: true },
      }),
      prisma.intercompanyLoan.findMany({ include: { transactions: true } }),
      buildAssetRegister(year),
      prisma.ownership.findMany({
        where: { ownerCompanyId: { not: null }, ownedCompanyId: { not: null }, endDate: null },
        select: { ownerCompanyId: true, ownedCompanyId: true, percentage: true },
      }),
      prisma.taxReserveRate.findMany({ where: { companyId: { not: "GLOBAL" } } }),
      yearRates(year),
      prisma.companyTaxStatus.findMany({ select: { companyId: true, year: true, taxTreatment: true } }),
    ]);

  // Trimestre só no ano vigente; anos anteriores entram como anual.
  const showQuarters = year === new Date().getUTCFullYear();
  // Treatment por (empresa, ano) e alíquota — fonte única (resolver + classRate), igual ao reserve.
  const resolveTreatment = buildTreatmentResolver(
    taxStatuses,
    returns.filter((r) => r.companyId && r.year != null) as Parameters<typeof buildTreatmentResolver>[1],
  );
  const override = new Map(overrideRows.map((o) => [o.companyId, Number(o.ratePct)]));
  const taxDep = new Map(assetReg.byCompany.map((b) => [b.companyId, b.yearDep]));
  const rateFor = (id: string) => classRate(resolveTreatment(id, year).treatment, override, id, yr);

  // ── Lucro por trimestre / anual ──
  const profitQ = new Map<string, (number | null)[]>(); // Q1..Q4
  const profitFY = new Map<string, number>();
  const hasQ = new Map<string, boolean>();
  const hasAnyPnl = new Set<string>();
  const pnlByCompany = new Map<string, { id: string; periodLabel: string }[]>();
  for (const p of pnls) {
    if (!p.companyId || yearOfLabel(p.periodLabel) !== year) continue;
    (pnlByCompany.get(p.companyId) ?? pnlByCompany.set(p.companyId, []).get(p.companyId)!).push(p);
  }
  for (const [cid, imps] of pnlByCompany) {
    const q: (number | null)[] = [null, null, null, null];
    let fy = 0;
    let anyQ = false;
    for (const imp of imps) {
      const ni = await netIncomeOf(imp.id);
      if (ni == null) continue;
      hasAnyPnl.add(cid);
      const pm = periodMonths(imp.periodLabel);
      fy += ni;
      if (showQuarters && pm && quarterOf(pm.start) === quarterOf(pm.end)) {
        const qi = quarterOf(pm.start) - 1;
        q[qi] = (q[qi] ?? 0) + ni;
        anyQ = true;
      }
    }
    profitQ.set(cid, q);
    profitFY.set(cid, fy);
    hasQ.set(cid, anyQ);
  }

  // Ajuste de depreciação livro→fiscal (confia no livro) por empresa — mesma regra das outras
  // telas. O valor APLICADO na base é 0 (livro já tem dep) ou taxDep (livro sem dep). Antes o
  // breakdown subtraía a MACRS sempre, contando a depreciação em dobro com a do livro no lucro.
  const yearImportIds = [...pnlByCompany.values()].flat().map((p) => p.id);
  const depLines = yearImportIds.length
    ? await prisma.qboImportLine.findMany({
        where: { importId: { in: yearImportIds }, lineType: "ACCOUNT" },
        select: { importId: true, lineType: true, label: true, value: true },
      })
    : [];
  const importToCompany = new Map<string, string>();
  for (const [cid, imps] of pnlByCompany) for (const p of imps) importToCompany.set(p.id, cid);
  const linesByCompany = new Map<string, { lineType: string; label: string; value: unknown }[]>();
  for (const l of depLines) {
    const cid = importToCompany.get(l.importId);
    if (!cid) continue;
    (linesByCompany.get(cid) ?? linesByCompany.set(cid, []).get(cid)!).push(l);
  }
  // appliedDep(id) = quanto a depreciação reduz a base (0 se confia no livro; taxDep se livro sem dep).
  const appliedDep = (id: string) => {
    const td = taxDep.get(id) ?? 0;
    const bookDep = bookDepFromLines(linesByCompany.get(id) ?? []);
    return -trustBookDepAdjustment(bookDep, td, taxDep.has(id)); // −adj: 0 ou taxDep
  };

  // ── Juros por trimestre (credor = in, tomador = out) ──
  const bounds = [0, 3, 6, 9, 12].map((m) => new Date(Date.UTC(m === 12 ? year + 1 : year, m === 12 ? 0 : m, 1)));
  const intIn = new Map<string, number[]>(); // [Q1..Q4]
  const intOut = new Map<string, number[]>();
  const loanMissing = new Set<string>();
  const add = (map: Map<string, number[]>, id: string, qi: number, v: number) => {
    const a = map.get(id) ?? [0, 0, 0, 0];
    a[qi] += v;
    map.set(id, a);
  };
  for (const loan of loans) {
    const rate = Number(loan.annualInterestRate.toString());
    const txns = loan.transactions.map((t) => ({ type: t.type, amount: t.amount.toString(), date: t.date }));
    const accruedAt = bounds.map((asOf) =>
      Number(
        computeLoanBalance(
          { annualInterestRate: loan.annualInterestRate.toString(), dayCountBasis: loan.dayCountBasis, startDate: loan.startDate },
          txns,
          asOf,
        ).interestAccrued.toString(),
      ),
    );
    for (let qi = 0; qi < 4; qi++) {
      const qInt = r2(accruedAt[qi + 1] - accruedAt[qi]);
      if (qInt === 0) continue;
      add(intIn, loan.lenderCompanyId, qi, qInt);
      add(intOut, loan.borrowerCompanyId, qi, qInt);
    }
    if (rate <= 0) {
      loanMissing.add(loan.lenderCompanyId);
      loanMissing.add(loan.borrowerCompanyId);
    }
  }

  // ── Standalone por trimestre (lucro + juros − dep), p/ depois atribuir K-1 ──
  const depQ = (id: string) => appliedDep(id) / 4;
  const standalone = (id: string, qi: number): number => {
    const p = profitQ.get(id)?.[qi];
    const profit = p ?? (hasQ.get(id) ? 0 : 0);
    const inn = intIn.get(id)?.[qi] ?? 0;
    const out = intOut.get(id)?.[qi] ?? 0;
    return r2((profit ?? 0) + inn - out - depQ(id));
  };
  const standaloneFY = (id: string): number => {
    const profit = profitFY.get(id) ?? 0;
    const inn = (intIn.get(id) ?? [0, 0, 0, 0]).reduce((s, v) => s + v, 0);
    const out = (intOut.get(id) ?? [0, 0, 0, 0]).reduce((s, v) => s + v, 0);
    return r2(profit + inn - out - appliedDep(id));
  };

  // K-1: a empresa (owner) recebe a fatia do resultado das suas investidas (owned).
  const ownedOf = new Map<string, { ownedId: string; pct: number }[]>();
  for (const o of ownerships) {
    if (!o.ownerCompanyId || !o.ownedCompanyId) continue;
    (ownedOf.get(o.ownerCompanyId) ?? ownedOf.set(o.ownerCompanyId, []).get(o.ownerCompanyId)!).push({
      ownedId: o.ownedCompanyId,
      pct: Number(o.percentage.toString()),
    });
  }

  const nameById = new Map(companies.map((c) => [c.id, c.legalName]));
  const rows: QBreakdownRow[] = [];
  for (const c of companies) {
    if (!pnlByCompany.has(c.id) && !ownedOf.has(c.id) && !intIn.has(c.id) && !intOut.has(c.id)) continue;
    const ratePct = rateFor(c.id);
    const annualOnly = !hasQ.get(c.id);
    const owned = ownedOf.get(c.id) ?? [];

    // Juros e depreciação saem por trimestre SEMPRE; o lucro só se houver P&L trimestral.
    const mkQuarter = (qi: number): QComp => {
      const profit = profitQ.get(c.id)?.[qi] ?? null; // null = lucro do trimestre desconhecido
      const inn = r2(intIn.get(c.id)?.[qi] ?? 0);
      const out = r2(intOut.get(c.id)?.[qi] ?? 0);
      const dep = r2(depQ(c.id));
      const k1 = r2(owned.reduce((s, o) => s + (standalone(o.ownedId, qi) * o.pct) / 100, 0));
      const base = profit == null ? null : r2(profit + inn - out - dep + k1);
      const tax = base == null ? null : base > 0 ? r2((base * ratePct) / 100) : 0;
      return { profit: profit == null ? null : r2(profit), interestIn: inn, interestOut: out, depreciation: dep, k1, base, tax };
    };
    const quarters: QComp[] = [0, 1, 2, 3].map(mkQuarter);

    // K-1 aberto por investida (cada empresa pass-through detida).
    const k1Items: K1Item[] = owned
      .map((o) => ({
        name: nameById.get(o.ownedId) ?? "investee",
        quarters: [0, 1, 2, 3].map((qi) => r2((standalone(o.ownedId, qi) * o.pct) / 100)),
        fy: r2((standaloneFY(o.ownedId) * o.pct) / 100),
      }))
      .filter((it) => it.fy !== 0 || it.quarters.some((q) => q !== 0))
      .sort((a, b) => Math.abs(b.fy) - Math.abs(a.fy));

    // FY
    const innFY = r2((intIn.get(c.id) ?? [0, 0, 0, 0]).reduce((s, v) => s + v, 0));
    const outFY = r2((intOut.get(c.id) ?? [0, 0, 0, 0]).reduce((s, v) => s + v, 0));
    const depFY = r2(appliedDep(c.id));
    const k1FY = r2(owned.reduce((s, o) => s + (standaloneFY(o.ownedId) * o.pct) / 100, 0));
    const profitFYv = r2(profitFY.get(c.id) ?? 0);
    const baseFY = r2(profitFYv + innFY - outFY - depFY + k1FY);
    const fy: QComp = {
      profit: profitFYv,
      interestIn: innFY,
      interestOut: outFY,
      depreciation: depFY,
      k1: k1FY,
      base: baseFY,
      tax: baseFY > 0 ? r2((baseFY * ratePct) / 100) : 0,
    };

    const missing: string[] = [];
    if (!hasAnyPnl.has(c.id)) missing.push("sem P&L do ano — lucro do período indisponível");
    if (loanMissing.has(c.id)) missing.push("empréstimo sem taxa — juros não calculados");
    for (const o of owned) {
      if (!hasAnyPnl.has(o.ownedId)) {
        missing.push(`K-1 de ${nameById.get(o.ownedId) ?? "investida"} — investida sem P&L`);
      }
    }

    rows.push({ companyId: c.id, name: c.legalName, currency: c.baseCurrency, ratePct, annualOnly, quarters, fy, k1Items, missing });
  }

  rows.sort((a, b) => (b.fy.tax ?? 0) - (a.fy.tax ?? 0));
  return { rows };
}
