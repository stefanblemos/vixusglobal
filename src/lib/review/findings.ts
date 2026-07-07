import { prisma } from "@/lib/db";
import {
  reconcileK1s,
  K1_PROBLEM_STATUSES,
  type K1Return,
  type K1Company,
} from "@/lib/ir/k1-reconcile";
import { booksIncomeNotOnReturnOf, type Figure } from "@/lib/ir/income-bridge";
import { finalClosingYear, type MiniReturn } from "@/lib/companies/closed";
import { effectiveFiguresOf } from "@/lib/ir/figures";
import { loadTreatmentDivergences } from "@/lib/tax/treatment";
import { pnlTotals } from "@/lib/qbo/pnl";

// Uma divergência/pendência detectada — para a fila de conferência consolidada.
export type ReviewFinding = {
  companyId: string | null;
  companyName: string;
  year: number | null;
  kind: "k1" | "income" | "missing-year" | "unregistered" | "treatment";
  severity: "high" | "medium" | "info";
  title: string;
  detail: string;
  href: string;
};

const usd = (v: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);

const einDigits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

export async function buildReviewFindings(): Promise<ReviewFinding[]> {
  const [companies, returns, pnlImports] = await Promise.all([
    prisma.company.findMany({
      select: {
        id: true,
        legalName: true,
        tradeName: true,
        aliases: true,
        taxId: true,
        formationDate: true,
        status: true,
        disregardedIntoId: true,
      },
    }),
    prisma.taxReturn.findMany({
      select: {
        id: true,
        companyId: true,
        matchedName: true,
        taxId: true,
        year: true,
        owners: true,
        k1sReceived: true,
        figures: true,
        manualFigures: true,
        isFinalReturn: true,
        taxForm: true,
      },
    }),
    prisma.qboImport.findMany({
      where: { reportKind: "PROFIT_AND_LOSS", companyId: { not: null } },
      select: { id: true, companyId: true, periodLabel: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const companyById = new Map(companies.map((c) => [c.id, c]));
  const findings: ReviewFinding[] = [];

  // ── 1) Divergências de K-1 × 1065 (intercompany) ────────────────────────────
  const k1Returns = returns.filter((r) => r.companyId);
  const edges = reconcileK1s(
    k1Returns as unknown as K1Return[],
    companies as unknown as K1Company[],
  );
  for (const e of edges) {
    if (!K1_PROBLEM_STATUSES.includes(e.status)) continue;
    const title =
      e.status === "amountDiff"
        ? `K-1 amount differs vs ${e.issuerName}`
        : e.status === "missingOnRecipient"
          ? `K-1 from ${e.issuerName} not reported`
          : `K-1 not on ${e.issuerName}'s 1065`;
    const detail =
      e.status === "amountDiff"
        ? `${e.issuerName} allocated ${usd(e.issuerAmount ?? 0)}; this return reports ${usd(e.recipientAmount ?? 0)}.`
        : e.status === "missingOnRecipient"
          ? `${e.issuerName} allocated ${usd(e.issuerAmount ?? 0)} on its 1065 — this return doesn't pick it up.`
          : `This return declared receiving ${usd(e.recipientAmount ?? 0)} that isn't on ${e.issuerName}'s 1065.`;
    findings.push({
      companyId: e.recipientId,
      companyName: e.recipientName,
      year: e.year,
      kind: "k1",
      severity: "high",
      title,
      detail,
      href: e.recipientId ? `/companies/${e.recipientId}/year/${e.year}` : "/tax/k1",
    });
  }

  // ── 2) Renda faturada nos livros (QBO) que não aparece na declaração ─────────
  // otherIncome por (companyId, ano), a partir do P&L mais recente de cada ano.
  const otherIncomeByKey = new Map<string, number>();
  if (pnlImports.length > 0) {
    const lines = await prisma.qboImportLine.findMany({
      where: { importId: { in: pnlImports.map((i) => i.id) }, lineType: "TOTAL" },
      select: { importId: true, lineType: true, label: true, value: true },
    });
    const linesByImport = new Map<string, typeof lines>();
    for (const l of lines) {
      const arr = linesByImport.get(l.importId);
      if (arr) arr.push(l);
      else linesByImport.set(l.importId, [l]);
    }
    // pnlImports já vem do mais recente para o mais antigo → o primeiro de cada chave vence.
    for (const imp of pnlImports) {
      const y = imp.periodLabel?.match(/\b(20\d{2})\b/)?.[1];
      if (!imp.companyId || !y) continue;
      const key = `${imp.companyId}:${y}`;
      if (otherIncomeByKey.has(key)) continue;
      const pnl = pnlTotals(linesByImport.get(imp.id) ?? []);
      if (pnl.otherIncome != null) otherIncomeByKey.set(key, pnl.otherIncome);
    }
  }
  for (const r of returns) {
    if (!r.companyId || r.year == null) continue;
    const oi = otherIncomeByKey.get(`${r.companyId}:${r.year}`);
    if (oi == null) continue;
    const gap = booksIncomeNotOnReturnOf(effectiveFiguresOf(r) as Figure[], oi);
    if (gap == null) continue;
    findings.push({
      companyId: r.companyId,
      companyName: companyById.get(r.companyId)?.legalName ?? r.matchedName ?? "—",
      year: r.year,
      kind: "income",
      severity: "high",
      title: "Income invoiced in the books but not on the return",
      detail: `QBO books ${usd(oi)} of other income; ${usd(gap)} isn't on the return (page-1 lines 5–7 or Schedule K).`,
      href: `/companies/${r.companyId}/year/${r.year}`,
    });
  }

  // ── 3) Anos de IR faltantes (do ano de abertura ao encerramento/último fechado) ─
  const currentYear = new Date().getFullYear();
  const returnsByCompany = new Map<string, MiniReturn[]>();
  for (const r of returns) {
    if (!r.companyId) continue;
    const mini: MiniReturn = { id: r.id, year: r.year, isFinalReturn: r.isFinalReturn, taxForm: r.taxForm };
    const arr = returnsByCompany.get(r.companyId);
    if (arr) arr.push(mini);
    else returnsByCompany.set(r.companyId, [mini]);
  }
  for (const c of companies) {
    if (c.disregardedIntoId) continue; // desconsiderada: declara dentro da dona, não tem IR próprio a cobrar
    const formationYear = c.formationDate
      ? Number((c.formationDate.match(/(?:19|20)\d{2}/) ?? [])[0]) || null
      : null;
    if (!formationYear) continue;
    const rs = returnsByCompany.get(c.id) ?? [];
    const yearsWith = new Set(rs.map((r) => r.year).filter((y): y is number => y != null));
    const finalYear = finalClosingYear(rs);
    const lastExpected =
      finalYear ?? (c.status === "INACTIVE" && yearsWith.size > 0 ? Math.max(...yearsWith) : currentYear - 1);
    const missing: number[] = [];
    for (let y = formationYear; y <= lastExpected; y++) if (!yearsWith.has(y)) missing.push(y);
    if (missing.length > 0) {
      findings.push({
        companyId: c.id,
        companyName: c.legalName,
        year: null,
        kind: "missing-year",
        severity: "medium",
        title: `Missing tax returns: ${missing.join(", ")}`,
        detail: `Formed ${c.formationDate}${finalYear ? ` · closed ${finalYear}` : ""} — these years have no return on file.`,
        href: `/companies/${c.id}?tab=history`,
      });
    }
  }

  // ── 4) Entidades novas não cadastradas (IR sem empresa) ──────────────────────
  const seen = new Set<string>();
  for (const r of returns) {
    if (r.companyId) continue;
    const key = einDigits(r.taxId) || (r.matchedName ?? "").trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    findings.push({
      companyId: null,
      companyName: r.matchedName ?? "Unknown entity",
      year: r.year,
      kind: "unregistered",
      severity: "medium",
      title: "New entity — not registered",
      detail: `${r.taxId ? `EIN ${r.taxId}` : "This return's EIN"} doesn't match any registered company. Register it in Tax.`,
      href: "/tax",
    });
  }

  // ── 5) Tributação: cadastro (CompanyTaxStatus) × IR discordam de classe no mesmo ano ──────────
  // Muda a alíquota (C-corp 21% × pass-through 30%) entre Reserve e fechamento se não for resolvido.
  for (const d of await loadTreatmentDivergences()) {
    findings.push({
      companyId: d.companyId,
      companyName: companyById.get(d.companyId)?.legalName ?? "—",
      year: d.year,
      kind: "treatment",
      severity: "high",
      title: "Tax treatment: registry and return disagree",
      detail: `Registered as ${d.statusValue} for ${d.year}, but the filed return is ${d.returnValue}. This flips the tax class (C-corp 21% vs pass-through 30%) — fix the year's tax status or the return so the reserve and the close agree.`,
      href: `/companies/${d.companyId}/year/${d.year}`,
    });
  }

  // Ordena: severidade (high→medium→info), depois empresa, depois ano desc.
  const rank = { high: 0, medium: 1, info: 2 };
  findings.sort(
    (a, b) =>
      rank[a.severity] - rank[b.severity] ||
      a.companyName.localeCompare(b.companyName) ||
      (b.year ?? 0) - (a.year ?? 0),
  );
  return findings;
}
