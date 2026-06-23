import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { labelForTaxTreatment, labelForJurisdiction } from "@/lib/catalog";
import { entityNames, ownerNameMatches } from "@/lib/ownership/reconcile";
import { reconcileK1s, type K1Return } from "@/lib/ir/k1-reconcile";
import {
  irOperatingOtherIncomeOf,
  irPassThroughOf,
  irSeparatelyStatedIncomeOf,
  booksIncomeNotOnReturnOf,
} from "@/lib/ir/income-bridge";
import { pnlTotals } from "@/lib/qbo/pnl";
import { buildDistExtracts, reconcileDistributions } from "@/lib/qbo/distributions";
import { detectYearAlerts, type YearSnapshot } from "@/lib/ir/year-close";
import { YearCloseControls } from "@/components/year-close-controls";
import { YearNoteField } from "@/components/year-note-field";

type Owner = {
  name: string;
  taxIdLast4: string | null;
  ownershipPct: number | null;
  allocatedIncome: number | null;
  role: string | null;
};

type Figure = { key: string; label: string; value: number | null; line: string | null };
type Pnl = ReturnType<typeof pnlTotals>;
type CmpRow = {
  label: string;
  ir: number | null;
  qbo: number | null;
  href?: string;
  strong?: boolean;
  taxOnly?: boolean;
  // reconcilesWith: diferença "esperada" explicada por um item conhecido (livro × imposto).
  reconcilesWith?: number | null;
  note?: string;
  // flag: linha que merece atenção (ex.: possível omissão de renda na declaração).
  flag?: boolean;
};

const money = (v: unknown, ccy = "USD") =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: ccy,
        maximumFractionDigits: 0,
      }).format(Number(v));

// Compara um valor do IR com o equivalente nos livros (QBO).
function compare(irVal: number | null, qboVal: number | null) {
  if (irVal == null && qboVal == null) return { status: "none" as const };
  if (irVal == null) return { status: "qboOnly" as const };
  if (qboVal == null) return { status: "irOnly" as const };
  const diff = qboVal - irVal;
  const tol = Math.max(1, Math.abs(irVal) * 0.01);
  return Math.abs(diff) <= tol
    ? { status: "match" as const, diff }
    : { status: "diff" as const, diff };
}

// Status final de uma linha: "diff" vira "reconciled" se o gap é explicado.
function rowEval(row: CmpRow) {
  const c = row.taxOnly ? null : compare(row.ir, row.qbo);
  const reconciled =
    !!c &&
    c.status === "diff" &&
    "diff" in c &&
    c.diff != null &&
    row.reconcilesWith != null &&
    Math.abs(c.diff - row.reconcilesWith) <= Math.max(1, Math.abs(row.reconcilesWith) * 0.02);
  return { c, status: reconciled ? "reconciled" : c?.status };
}

// Agrupa os line items do IR como o próprio 1065 é estruturado, para a tabela não
// misturar entrada e saída (ex.: "Interest" linha 15 = despesa vs "Interest income" Sch K
// linha 5 = receita).
const FIGURE_SECTIONS = [
  { key: "income", label: "Income (Form 1065, page 1)" },
  { key: "deductions", label: "Deductions (Form 1065, page 1)" },
  { key: "result", label: "Result" },
  { key: "schk", label: "Schedule K — separately stated to the partners" },
  { key: "recon", label: "Reconciliation, tax & balance sheet" },
] as const;

function figureSection(f: Figure): string {
  const line = (f.line ?? "").toLowerCase();
  const k = f.key;
  if (/\bsch(?:edule)?\s*k\b/.test(line)) return "schk";
  if (k === "ORDINARY_INCOME" || /1065 line 23\b/.test(line)) return "result";
  if (["GROSS_RECEIPTS", "COST_OF_GOODS", "OTHER_INCOME", "TOTAL_INCOME"].includes(k))
    return "income";
  if (["TOTAL_DEDUCTIONS", "DEPRECIATION"].includes(k)) return "deductions";
  const m = line.match(/1065 line (\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (n <= 8) return "income";
    if (n >= 9 && n <= 22) return "deductions";
    if (n === 23) return "result";
  }
  return "recon";
}

// Saída (despesa/dedução): mostrada entre parênteses e em rosa suave — para diferenciar de
// entrada SEM usar o vermelho forte, que aqui é reservado a alertas/divergências.
const isOutflowFigure = (f: Figure) => figureSection(f) === "deductions";

// Monta o espelho IR × QBO camada a camada (descontando COGS, com ponte M-1).
function buildCmpRows(
  figures: Figure[],
  pnl: Pnl,
  depTotal: number | null,
  companyId: string,
  pnlHref: string | undefined,
): CmpRow[] {
  const figVal = (k: string) => figures.find((f) => f.key === k)?.value ?? null;
  const nonDeductible =
    figVal("NON_DEDUCTIBLE") ??
    figures.find((f) => /nondeduct|n[aã]o.?dedut/i.test(f.label))?.value ??
    null;
  // Schedule M-1 linha 8 — deduções no IR que não estão no livro (depreciação extra,
  // custos reclassificados). Junto com a linha 5 (nonDeductible) explica todo o gap de despesas.
  const deductionsNotOnBooks = figVal("DEDUCTIONS_NOT_ON_BOOKS");
  // Componentes itemizados do add-back (M-1 linha 5): "M-1: Federal income tax", etc.
  const m1Items = figures.filter((f) => /^\s*m-1:/i.test(f.label));
  const irRevenue = figVal("GROSS_RECEIPTS");
  const irCogs = figVal("COST_OF_GOODS");
  const irGrossProfit = irRevenue != null ? irRevenue - (irCogs ?? 0) : null;
  const irOperatingOther = irOperatingOtherIncomeOf(figures);
  const irPassThrough = irPassThroughOf(figures);
  const irSeparatelyStated = irSeparatelyStatedIncomeOf(figures);
  const booksNotOnReturn = booksIncomeNotOnReturnOf(figures, pnl.otherIncome);
  // O "Other Income" do QBO casa com a soma do operacional (linhas 5–7) + o separadamente
  // declarado na Schedule K (juros, dividendos…). Se ambos forem null, mantém null.
  const irOtherCombined =
    irOperatingOther == null && irSeparatelyStated == null
      ? null
      : (irOperatingOther ?? 0) + (irSeparatelyStated ?? 0);
  // Ordinary business income = linha 22 (pelo rótulo), não o 1º match de ORDINARY_INCOME.
  const irOrdinary =
    figures.find((f) => /ordinary business income/i.test(f.label))?.value ??
    figVal("ORDINARY_INCOME");
  const irBookNet = figVal("NET_INCOME") ?? irOrdinary;
  // Ponte livro→imposto: o lucro contábil (QBO) inclui a renda separadamente declarada e o
  // K-1 alocado; a renda ordinária da página 1 NÃO. Então: + K-1 alocado (no IR, não no
  // caixa), − renda separadamente declarada (na Schedule K, fora da ordinária), − renda
  // faturada que ficou de fora (omissão). Assim cada dólar é explicado e só a omissão real
  // aparece sinalizada.
  const qboOrdinary =
    pnl.netIncome != null
      ? pnl.netIncome +
        (nonDeductible ?? 0) -
        (deductionsNotOnBooks ?? 0) +
        (irPassThrough ?? 0) -
        (irSeparatelyStated ?? 0) -
        (booksNotOnReturn ?? 0)
      : null;

  return [
    { label: "Gross receipts / revenue", ir: irRevenue, qbo: pnl.revenue, href: pnlHref },
    { label: "Cost of goods sold", ir: irCogs, qbo: pnl.cogs, href: pnlHref },
    { label: "Gross profit", ir: irGrossProfit, qbo: pnl.grossProfit, href: pnlHref },
    {
      label: "Total deductions / expenses",
      ir: figVal("TOTAL_DEDUCTIONS"),
      qbo: pnl.expenses,
      href: pnlHref,
      // Identidade M-1: gap (despesa QBO − dedução IR) = add-back não-dedutível (ln 5)
      //  − deduções reclassificadas para a declaração (ln 8)
      //  − restatement do livro (net income QBO vs "per books" do retorno).
      reconcilesWith:
        nonDeductible != null
          ? nonDeductible -
            (deductionsNotOnBooks ?? 0) -
            ((pnl.netIncome ?? 0) - (irBookNet ?? 0))
          : null,
      note:
        nonDeductible != null
          ? "gap = non-deductible add-backs (Schedule M-1) — see breakdown below"
          : undefined,
    },
    {
      label: "Other income (operating + separately stated)",
      ir: irOtherCombined,
      qbo: pnl.otherIncome,
      href: pnlHref,
      // Se os livros faturam e o IR não reporta em lugar nenhum, é possível omissão.
      flag: booksNotOnReturn != null,
      note:
        booksNotOnReturn != null
          ? "invoiced in the books but not on the return — possible omission"
          : irSeparatelyStated != null
            ? "incl. interest/dividends reported separately on Schedule K"
            : undefined,
    },
    ...(irPassThrough != null
      ? [
          {
            label: "Pass-through income (K-1, line 4)",
            ir: irPassThrough,
            qbo: null,
            // Renda alocada de investidas — não-caixa; concilia no painel de K-1, não no QBO.
            note: "allocated K-1 from investees — non-cash, see K-1 panel",
          },
        ]
      : []),
    {
      label: "Net income (per books)",
      ir: irBookNet,
      qbo: pnl.netIncome,
      href: pnlHref,
      strong: true,
    },
    { label: "+ Non-deductible expenses (Schedule M-1, line 5)", ir: nonDeductible, qbo: null, taxOnly: true },
    // Itemizado do add-back (M-1 linha 5): federal tax, state tax, 50% meals, charitable…
    ...m1Items.map((f) => ({
      label: `      ${f.label.replace(/^\s*m-1:\s*/i, "")}`,
      ir: f.value,
      qbo: null,
      taxOnly: true as const,
    })),
    ...(deductionsNotOnBooks != null && deductionsNotOnBooks !== 0
      ? [
          {
            label: "− Deductions on the return not in the books (Schedule M-1, line 8)",
            ir: -deductionsNotOnBooks,
            qbo: null,
            taxOnly: true,
          },
        ]
      : []),
    ...(irPassThrough != null && irPassThrough !== 0
      ? [
          {
            label: "+ Pass-through K-1 income on return, not in cash books (M-1 line 2)",
            ir: irPassThrough,
            qbo: null,
            taxOnly: true,
          },
        ]
      : []),
    ...(irSeparatelyStated != null && irSeparatelyStated !== 0
      ? [
          {
            label: "− Income separately stated on Schedule K (interest/dividends, not in ordinary)",
            ir: -irSeparatelyStated,
            qbo: null,
            taxOnly: true,
          },
        ]
      : []),
    ...(booksNotOnReturn != null
      ? [
          {
            label: "− Income invoiced in the books but missing from the return",
            ir: -booksNotOnReturn,
            qbo: null,
            taxOnly: true,
            flag: true,
          },
        ]
      : []),
    {
      label: "= Ordinary business income (taxable)",
      ir: irOrdinary,
      qbo: qboOrdinary,
      href: pnlHref,
      strong: true,
    },
    {
      label: "Depreciation (per GL)",
      ir: figVal("DEPRECIATION"),
      qbo: depTotal,
      href: depTotal != null ? `/ledger?company=${companyId}` : undefined,
    },
  ];
}

export default async function CompanyYearPage({
  params,
}: {
  params: Promise<{ id: string; year: string }>;
}) {
  const { id, year: yearStr } = await params;
  const year = parseInt(yearStr, 10);

  const [company, taxReturns, taxStatus, ownerships, parties, companies, yearReturns] =
    await Promise.all([
      prisma.company.findUnique({ where: { id } }),
      prisma.taxReturn.findMany({
        where: { companyId: id, year },
        omit: { pdf: true },
        orderBy: { createdAt: "desc" },
      }),
      prisma.companyTaxStatus.findFirst({ where: { companyId: id, year } }),
      prisma.ownership.findMany({ where: { ownedCompanyId: id } }),
      prisma.party.findMany(),
      prisma.company.findMany(),
      // Todos os IRs do MESMO ano (p/ validar os K-1 recebidos contra o IR do emissor).
      prisma.taxReturn.findMany({
        where: { year, companyId: { not: null } },
        select: { companyId: true, owners: true, taxForm: true },
      }),
    ]);
  if (!company) notFound();

  const partyById = new Map(parties.map((p) => [p.id, p.name]));
  const companyById = new Map(companies.map((c) => [c.id, c]));
  // Cada dono registrado guarda TODOS os nomes pelos quais pode ser conhecido
  // (razão social + nome fantasia + aliases) — o IR pode usar o nome ANTIGO da
  // empresa (ex.: L&L → L2), então casar só pela razão social atual falha.
  const registered = ownerships
    .map((o) => {
      if (o.ownerPartyId) {
        const n = partyById.get(o.ownerPartyId);
        return n ? { names: [n], pct: Number(o.percentage) } : null;
      }
      const c = o.ownerCompanyId ? companyById.get(o.ownerCompanyId) : null;
      return c ? { names: entityNames(c), pct: Number(o.percentage) } : null;
    })
    .filter((r): r is { names: string[]; pct: number } => !!r);

  function reconcile(partner: Owner) {
    if (registered.length === 0) return { status: "none" as const };
    const hit = registered.find((r) => ownerNameMatches(r.names, partner.name));
    if (!hit) return { status: "missing" as const };
    if (partner.ownershipPct == null) return { status: "registered" as const, pct: hit.pct };
    return Math.abs(hit.pct - partner.ownershipPct) <= 0.5
      ? { status: "match" as const, pct: hit.pct }
      : { status: "diff" as const, pct: hit.pct };
  }

  // ── K-1 recebidos: casa o emissor (EIN ou nome) e valida contra o IR dele ──
  const einDigits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
  const companyByEin = new Map(
    companies.filter((c) => einDigits(c.taxId)).map((c) => [einDigits(c.taxId), c]),
  );
  const yearReturnByCompany = new Map(
    yearReturns.filter((r) => r.companyId).map((r) => [r.companyId!, r]),
  );
  const filerNames = entityNames(company);

  type K1Recv = { issuerName: string; issuerEin: string; amount: number };
  function evalK1(k: K1Recv) {
    const ein = einDigits(k.issuerEin);
    let issuer = ein ? companyByEin.get(ein) : undefined;
    if (!issuer) issuer = companies.find((c) => ownerNameMatches(entityNames(c), k.issuerName));
    if (!issuer) return { status: "unregistered" as const, issuer: null, expected: null };

    const ret = yearReturnByCompany.get(issuer.id);
    if (!ret) return { status: "missing" as const, issuer, expected: null };

    const owners = (ret.owners as { name: string; allocatedIncome: number | null }[] | null) ?? [];
    const me = owners.find((o) => ownerNameMatches(filerNames, o.name));
    const expected = me?.allocatedIncome ?? null;
    if (expected == null) return { status: "noAlloc" as const, issuer, expected: null };
    const tol = Math.max(1, Math.abs(k.amount) * 0.01);
    const matches = Math.abs(expected - k.amount) <= tol;
    // Casa dentro de 1% → é o K-1 (mostra o valor do emissor). Não casa → é uma das
    // distribuições de lucro lançadas junto na linha 10 (não é K-1); não repete o valor do
    // emissor nem marca "differs" — sai em branco e fica pro painel de distribuições do QBO.
    return {
      status: matches ? ("validated" as const) : ("distribution" as const),
      issuer,
      expected: matches ? expected : null,
    };
  }

  const depTxns = await prisma.ledgerTxn.findMany({
    where: {
      companyId: id,
      account: { contains: "epreciat" },
      NOT: { account: { contains: "ccumulated" } },
      date: {
        gte: new Date(`${year}-01-01T00:00:00Z`),
        lt: new Date(`${year + 1}-01-01T00:00:00Z`),
      },
    },
    select: { amount: true },
  });
  const depTotal = depTxns.length ? depTxns.reduce((s, t) => s + Number(t.amount), 0) : null;

  // P&L do QBO do mesmo ano, para o cruzamento.
  const pnlImport = await prisma.qboImport.findFirst({
    where: {
      companyId: id,
      reportKind: "PROFIT_AND_LOSS",
      periodLabel: { contains: String(year) },
    },
    orderBy: { createdAt: "desc" },
  });
  const pnlLines = pnlImport
    ? await prisma.qboImportLine.findMany({ where: { importId: pnlImport.id, lineType: "TOTAL" } })
    : [];
  const pnl = pnlTotals(pnlLines);

  // Folhas (contas) da seção "Other Income" do QBO — para detalhar de onde vem a renda.
  const otherIncomeLines = pnlImport
    ? await prisma.qboImportLine.findMany({
        where: {
          importId: pnlImport.id,
          lineType: "ACCOUNT",
          sectionPath: { has: "Other Income" },
        },
        orderBy: { rowIndex: "asc" },
      })
    : [];

  const pnlHref = pnlImport ? `/import/${pnlImport.id}` : undefined;

  // Lado EMISSOR da conciliação K-1: investidas que alocaram renda a ESTA empresa neste ano.
  // Se o IR dela não puxou (nem na linha 4 em bloco), o contador esqueceu o pass-through.
  const allK1Returns = await prisma.taxReturn.findMany({
    where: { companyId: { not: null } },
    select: {
      companyId: true,
      year: true,
      taxForm: true,
      owners: true,
      k1sReceived: true,
      figures: true,
    },
  });
  const k1Omissions = reconcileK1s(allK1Returns as unknown as K1Return[], companies).filter(
    (e) =>
      e.recipientId === id &&
      e.year === year &&
      (e.status === "missingOnRecipient" || e.status === "amountDiff"),
  );

  // Distribuições de lucro (fora do K-1) pelos relatórios do QBO: o que ESTA empresa lançou
  // como "1099 - Not K1", correlacionado com o que a subsidiária deduziu no P&L dela.
  const distImports = await prisma.qboImport.findMany({
    where: { reportKind: "PROFIT_AND_LOSS", companyId: { not: null } },
    select: { id: true, companyId: true, periodLabel: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });
  const distLines =
    distImports.length > 0
      ? await prisma.qboImportLine.findMany({
          where: { importId: { in: distImports.map((i) => i.id) }, lineType: { in: ["ACCOUNT", "TOTAL"] } },
          select: { importId: true, label: true, sectionPath: true, lineType: true, value: true },
        })
      : [];
  const distExtracts = buildDistExtracts(distImports, distLines);
  const distReceived = reconcileDistributions(distExtracts, companies).filter(
    (e) => e.recipientId === id && e.year === year,
  );

  // Nota livre de justificativa para este ano (divergências que não fecham sozinhas).
  const yearNote = await prisma.companyYearNote.findUnique({
    where: { companyId_year: { companyId: id, year } },
  });

  // Fechamento do ano (lock) + alertas: compara a verdade travada com o IR mais recente.
  const yearClose = await prisma.yearClose.findUnique({
    where: { companyId_year: { companyId: id, year } },
  });
  const latestIr = taxReturns[0] ?? null;
  const snapshot = (yearClose?.snapshot as YearSnapshot | null) ?? null;
  const alerts =
    snapshot && latestIr
      ? detectYearAlerts(snapshot, {
          taxForm: latestIr.taxForm,
          taxTreatment: latestIr.taxTreatment,
          entityType: latestIr.entityType,
          figures: (latestIr.figures as Figure[] | null) ?? [],
          owners: (latestIr.owners as Owner[] | null) ?? [],
        })
      : [];
  // Quantas linhas do espelho IR×QBO seguem divergentes (não explicadas) — hint do lock.
  const primaryRows = latestIr
    ? buildCmpRows((latestIr.figures as Figure[] | null) ?? [], pnl, depTotal, id, pnlHref)
    : [];
  const unreconciledCount = primaryRows.filter(
    (r) => !r.taxOnly && rowEval(r).status === "diff",
  ).length;

  const ccy = company.baseCurrency;

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/companies/${id}?tab=history`}
          className="text-sm text-slate-500 hover:text-slate-700"
        >
          ← {company.legalName}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">
          {company.legalName} · {year}
        </h1>
        <p className="text-sm text-slate-500">
          Everything on file for this year, extracted from the documents.
        </p>
      </div>

      {/* Lock do ano + alertas (verdade travada vs IR arquivado) */}
      <section className="space-y-2">
        <YearCloseControls
          companyId={id}
          year={year}
          locked={!!yearClose}
          lockedAt={yearClose ? yearClose.lockedAt.toISOString() : null}
          lockedBy={yearClose?.lockedBy ?? null}
          unreconciledCount={unreconciledCount}
          alertCount={alerts.length}
        />
        {alerts.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-red-200 bg-white">
            <div className="border-b border-red-100 bg-red-50/60 px-4 py-2 text-sm font-medium text-red-800">
              ⚠ Possible accountant errors — the filed return differs from the locked baseline
            </div>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Item</th>
                  <th className="px-4 py-2 font-medium">Locked</th>
                  <th className="px-4 py-2 font-medium">Filed return</th>
                  <th className="px-4 py-2 font-medium">What changed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {alerts.map((a, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 font-medium text-slate-800">{a.field}</td>
                    <td className="px-4 py-2 tabular-nums text-slate-600">{a.expected}</td>
                    <td className="px-4 py-2 tabular-nums text-red-700">{a.got}</td>
                    <td className="px-4 py-2 text-slate-500">{a.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Pass-through que investidas alocaram a esta empresa e o IR dela não declarou */}
      {k1Omissions.length > 0 && (
        <section className="overflow-hidden rounded-xl border border-red-200 bg-white">
          <div className="border-b border-red-100 bg-red-50/60 px-4 py-2 text-sm font-medium text-red-800">
            ⚠ K-1 income an investee allocated to this company that the return doesn&rsquo;t report
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Investee (issuer)</th>
                <th className="px-4 py-2 text-right font-medium">Allocated on its 1065</th>
                <th className="px-4 py-2 text-right font-medium">Picked up here</th>
                <th className="px-4 py-2 font-medium">What to check</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {k1Omissions.map((e, i) => (
                <tr key={i}>
                  <td className="px-4 py-2 font-medium text-slate-800">
                    {e.issuerId ? (
                      <Link
                        href={`/companies/${e.issuerId}/year/${year}`}
                        className="text-[#1f3a5f] hover:underline"
                      >
                        {e.issuerName}
                      </Link>
                    ) : (
                      e.issuerName
                    )}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                    {money(e.issuerAmount, ccy)}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-red-700">
                    {e.recipientAmount != null ? money(e.recipientAmount, ccy) : "not on the return"}
                  </td>
                  <td className="px-4 py-2 text-slate-500">
                    {e.status === "amountDiff"
                      ? "The amount on the issuer's 1065 differs from what this return reports — reconcile the two."
                      : "The issuer allocated this on its 1065 (the K-1 it issued); this return doesn't pick it up on line 4 or itemize it."}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="px-4 py-2 text-xs text-slate-400">
            A partnership K-1 (allocated income/loss) is taxable to the partner even when no cash was
            distributed; a cash distribution by itself is not. Confirm this allocation reached the
            return — and, for a loss, that it wasn&rsquo;t simply dropped.
          </p>
        </section>
      )}

      {/* Tax classification for the year */}
      <section className="space-y-2">
        <h2 className="text-lg font-medium text-slate-800">Tax situation</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Field label="Tax treatment">
            {taxStatus
              ? labelForTaxTreatment(taxStatus.taxTreatment)
              : taxReturns[0]?.taxTreatment
                ? `${labelForTaxTreatment(taxReturns[0].taxTreatment)} (from IR)`
                : "—"}
          </Field>
          <Field label="Entity / form">
            {taxReturns[0]?.taxForm ?? taxStatus?.entityType ?? "—"}
          </Field>
          <Field label="Jurisdiction">
            {labelForJurisdiction(company.jurisdiction)}
            {company.state ? ` · ${company.state}` : ""}
          </Field>
        </div>
      </section>

      {taxReturns.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No income tax return on file for {year}.
        </div>
      ) : (
        taxReturns.map((r) => {
          const owners = (r.owners as Owner[] | null) ?? [];
          const figures = (r.figures as Figure[] | null) ?? [];
          const figVal = (k: string) => figures.find((f) => f.key === k)?.value ?? null;
          const cmpRows = buildCmpRows(figures, pnl, depTotal, id, pnlHref);
          const irOperatingOther = irOperatingOtherIncomeOf(figures);
          const irPassThrough = irPassThroughOf(figures);
          const irSeparatelyStated = irSeparatelyStatedIncomeOf(figures);
          const booksNotOnReturn = booksIncomeNotOnReturnOf(figures, pnl.otherIncome);
          // KPIs do header são form-aware: numa partnership/S-corp/disregarded (pass-through)
          // não existe "taxable income"/"total tax" no nível da entidade — o resultado (linha 22)
          // passa para os sócios. Depreciação vem do IR (linha 16), com o GL como fallback.
          const irOrdinary =
            figures.find((f) => /ordinary business income/i.test(f.label))?.value ??
            figVal("ORDINARY_INCOME");
          const passThrough = ["PARTNERSHIP", "S_CORP", "DISREGARDED", "SOLE_PROP"].includes(
            r.taxTreatment ?? "",
          );
          const taxableVal = figVal("TAXABLE_INCOME");
          const totalTaxVal = figVal("TOTAL_TAX");
          const depIr = figVal("DEPRECIATION");
          return (
            <section key={r.id} className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-medium text-slate-800">
                  Income tax return — {r.taxForm ?? r.fileName}
                </h2>
                {r.pdfSize != null && (
                  <a
                    href={`/api/tax-returns/${r.id}/pdf`}
                    target="_blank"
                    rel="noopener"
                    className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                  >
                    View original PDF
                  </a>
                )}
              </div>

              {r.taxTreatment === "C_CORP" && (
                <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-3 py-2 text-sm text-indigo-800">
                  <strong>C-corp:</strong> tax on this income is paid by the entity itself (Form
                  1120). It does <strong>not</strong> pass through to the owners — they&rsquo;re taxed
                  only on dividends distributed (Form 1099-DIV). So this income won&rsquo;t appear on
                  the partners&rsquo; 1040.
                </div>
              )}

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi
                  label="Total income"
                  value={money(figVal("TOTAL_INCOME") ?? r.totalIncome, ccy)}
                />
                <Kpi
                  label={taxableVal != null ? "Taxable income" : "Ordinary income"}
                  value={money(taxableVal ?? irOrdinary, ccy)}
                  hint={taxableVal == null && passThrough ? "passes to partners" : undefined}
                />
                <Kpi
                  label={totalTaxVal == null && passThrough ? "Entity tax" : "Total tax"}
                  value={money(totalTaxVal ?? (passThrough ? 0 : null), ccy)}
                  hint={totalTaxVal == null && passThrough ? "passes to partners" : undefined}
                />
                <Kpi
                  label="Depreciation"
                  value={money(depIr ?? depTotal, ccy)}
                  hint={depIr != null ? "per IR" : depTotal != null ? "per GL" : undefined}
                />
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
                <Field label="EIN / Tax ID">{r.taxId ?? "—"}</Field>
                <Field label="Location">
                  {r.address ?? (r.state ? `${r.city ? `${r.city}, ` : ""}${r.state}` : "—")}
                </Field>
                <Field label="Business activity">{r.businessActivity ?? "—"}</Field>
                <Field label="Incorporated">{r.incorporationDate ?? "—"}</Field>
                <Field label="Responsible">{r.responsible ?? "—"}</Field>
                <Field label="Preparer">{r.preparer ?? "—"}</Field>
                <Field label="Confidence">{r.confidence ?? "—"}</Field>
                <Field label="File">
                  {r.pdfSize != null ? `${r.fileName} (stored)` : `${r.fileName} (no PDF)`}
                </Field>
              </div>

              {figures.length > 0 && (
                <div>
                  <div className="mb-1 text-sm font-medium text-slate-700">
                    Tax return — line items
                  </div>
                  <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                          <th className="px-4 py-2 font-medium">Item</th>
                          <th className="px-4 py-2 font-medium">Form line</th>
                          <th className="px-4 py-2 text-right font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {FIGURE_SECTIONS.flatMap((sec) => {
                          const items = figures.filter((f) => figureSection(f) === sec.key);
                          if (items.length === 0) return [];
                          return [
                            <tr key={`h-${sec.key}`} className="bg-slate-50/70">
                              <td
                                colSpan={3}
                                className="px-4 py-1.5 text-xs font-medium tracking-wide text-slate-400 uppercase"
                              >
                                {sec.label}
                              </td>
                            </tr>,
                            ...items.map((f, i) => {
                              const out = isOutflowFigure(f);
                              return (
                                <tr key={`${sec.key}-${i}`}>
                                  <td className="px-4 py-2 text-slate-700">{f.label}</td>
                                  <td className="px-4 py-2 text-slate-400">{f.line ?? "—"}</td>
                                  <td
                                    className={`px-4 py-2 text-right tabular-nums ${out ? "text-rose-600" : "text-slate-800"}`}
                                  >
                                    {out && f.value != null
                                      ? `(${money(f.value, ccy)})`
                                      : money(f.value, ccy)}
                                  </td>
                                </tr>
                              );
                            }),
                          ];
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* IR × QBO */}
              <div>
                <div className="mb-1 text-sm font-medium text-slate-700">
                  Tax return vs books (QBO {year})
                </div>
                {!pnlImport && (
                  <p className="mb-1 text-xs text-amber-600">
                    No QBO Profit &amp; Loss on file for {year} — import it to compare income.
                  </p>
                )}
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                      <tr>
                        <th className="px-4 py-2 font-medium">Figure</th>
                        <th className="px-4 py-2 text-right font-medium">Per the IR</th>
                        <th className="px-4 py-2 text-right font-medium">Per the books (QBO)</th>
                        <th className="px-4 py-2 text-right font-medium">Difference</th>
                        <th className="px-4 py-2 text-right font-medium">Check</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {cmpRows.map((row) => {
                        const { c, status } = rowEval(row);
                        return (
                          <tr
                            key={row.label}
                            className={
                              row.flag ? "bg-red-50/50" : row.strong ? "bg-slate-50/40" : ""
                            }
                          >
                            <td
                              className={`px-4 py-2 ${row.flag ? "font-medium text-red-700" : row.strong ? "font-medium text-slate-800" : "text-slate-700"}`}
                            >
                              {row.label}
                              {row.note && (
                                <span
                                  className={`block text-xs font-normal ${row.flag ? "text-red-500" : "text-slate-400"}`}
                                >
                                  {row.note}
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                              {money(row.ir, ccy)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                              {row.qbo != null && row.href ? (
                                <Link href={row.href} className="text-[#1f3a5f] hover:underline">
                                  {money(row.qbo, ccy)}
                                </Link>
                              ) : (
                                money(row.qbo, ccy)
                              )}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                              {c && "diff" in c && c.diff != null ? money(c.diff, ccy) : "—"}
                            </td>
                            <td className="px-4 py-2 text-right">
                              {row.flag ? (
                                <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs whitespace-nowrap text-red-700">
                                  review
                                </span>
                              ) : row.taxOnly ? (
                                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs whitespace-nowrap text-slate-500">
                                  M-1 add-back
                                </span>
                              ) : status ? (
                                <CmpBadge status={status} />
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Net income (per books) should match between the IR and the QBO books; the gap to
                  taxable income is the non-deductible add-back (Schedule M-1 / K line 18c). A
                  &ldquo;reconciles ✓&rdquo; row means the difference is fully explained by a known
                  book-vs-tax item. Click a QBO value to open the source report.
                </p>

                {otherIncomeLines.length > 0 && (
                  <details className="mt-2 rounded-xl border border-slate-200 bg-white">
                    <summary className="cursor-pointer px-4 py-2 text-sm font-medium text-slate-700">
                      Other income — QBO breakdown vs IR
                    </summary>
                    <div className="border-t border-slate-100 px-4 py-3">
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-slate-100">
                          {otherIncomeLines.map((l) => (
                            <tr key={l.id}>
                              <td className="py-1.5 text-slate-600">{l.label}</td>
                              <td className="py-1.5 text-right tabular-nums text-slate-600">
                                {money(l.value, ccy)}
                              </td>
                            </tr>
                          ))}
                          <tr className="border-t-2 border-slate-200 font-medium">
                            <td className="py-1.5 text-slate-700">
                              Total per QBO books (invoiced)
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-slate-800">
                              {money(pnl.otherIncome, ccy)}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-1.5 text-slate-600">
                              Per the IR — operating other income (Form 1065 lines 5–7)
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-slate-600">
                              {money(irOperatingOther, ccy)}
                            </td>
                          </tr>
                          {irSeparatelyStated != null && (
                            <tr className="text-emerald-700">
                              <td className="py-1.5">
                                On the IR — separately stated on Schedule K (interest, dividends,
                                etc.)
                              </td>
                              <td className="py-1.5 text-right tabular-nums">
                                {money(irSeparatelyStated, ccy)}
                              </td>
                            </tr>
                          )}
                          {booksNotOnReturn != null && (
                            <tr className="font-medium text-red-700">
                              <td className="py-1.5">
                                Invoiced in the books but missing from the return — possible omission
                              </td>
                              <td className="py-1.5 text-right tabular-nums">
                                {money(booksNotOnReturn, ccy)}
                              </td>
                            </tr>
                          )}
                          {irPassThrough != null && (
                            <tr className="text-slate-500">
                              <td className="py-1.5">
                                Memo — K-1 pass-through (line 4, non-cash; shown in the K-1 panel)
                              </td>
                              <td className="py-1.5 text-right tabular-nums">
                                {money(irPassThrough, ccy)}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <p className="mt-2 text-xs text-slate-400">
                        The books&rsquo; &ldquo;other income&rdquo; can land in three places on the
                        return: operating income on page 1 (lines 5–7); interest, dividends and
                        other investment income separately stated on Schedule K (green — on the
                        return, just not in ordinary business income); or the K-1 pass-through on
                        line 4 (non-cash, reconciled in the K-1 panel). A red line means the books
                        invoiced income the return shows in none of these — a possible omission to
                        confirm.
                      </p>
                    </div>
                  </details>
                )}
              </div>

              {(() => {
                const k1s = (r.k1sReceived as K1Recv[] | null) ?? [];
                if (k1s.length === 0) return null;
                const rows = k1s.map((k) => ({ k, e: evalK1(k) }));
                const total = k1s.reduce((s, k) => s + k.amount, 0);
                const awaiting = rows.filter((x) => x.e.status === "missing").length;
                return (
                  <div>
                    <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-slate-700">
                        K-1s received — income from investees
                      </span>
                      {awaiting > 0 && (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                          {awaiting} awaiting the issuer&apos;s {year} return
                        </span>
                      )}
                    </div>
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-slate-500">
                          <tr>
                            <th className="px-4 py-2 font-medium">Issuer (investee)</th>
                            <th className="px-4 py-2 font-medium">EIN</th>
                            <th className="px-4 py-2 text-right font-medium">Reported here</th>
                            <th className="px-4 py-2 text-right font-medium">
                              Per issuer&apos;s return
                            </th>
                            <th className="px-4 py-2 text-right font-medium">Check</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {rows.map(({ k, e }, i) => (
                            <tr key={i}>
                              <td className="px-4 py-2 text-slate-700">
                                {e.issuer ? (
                                  <Link
                                    href={`/companies/${e.issuer.id}/year/${year}`}
                                    className="text-[#1f3a5f] hover:underline"
                                  >
                                    {e.issuer.legalName}
                                  </Link>
                                ) : (
                                  k.issuerName
                                )}
                              </td>
                              <td className="px-4 py-2 text-xs text-slate-400">
                                {k.issuerEin || "—"}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                                {money(k.amount, ccy)}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                                {e.expected != null ? money(e.expected, ccy) : "—"}
                              </td>
                              <td className="px-4 py-2 text-right">
                                <K1Badge status={e.status} year={year} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-200 bg-slate-50/60">
                          <tr>
                            <td className="px-4 py-2 font-medium text-slate-700" colSpan={2}>
                              Total received from investees (net)
                            </td>
                            <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                              {money(total, ccy)}
                            </td>
                            <td colSpan={2} />
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Each K-1 this company received from an investee, matched by EIN/name. The
                      issuer&apos;s value is shown only where it matches (±1%); a row marked &ldquo;
                      profit distribution&rdquo; doesn&apos;t match the issuer&apos;s K-1 — it&apos;s
                      a profit distribution booked on the same line, reconciled in the &ldquo;Profit
                      distributions (QBO)&rdquo; panel below. &ldquo;Awaiting return&rdquo; = the
                      investee&apos;s {year} return isn&apos;t on file yet to validate the amount.
                    </p>
                  </div>
                );
              })()}

              {r.summary && <p className="text-sm text-slate-500">{r.summary}</p>}

              <div>
                <div className="mb-1 text-sm font-medium text-slate-700">
                  Partners / shareholders — checked vs registered ownership
                </div>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {owners.length === 0 ? (
                    <p className="p-4 text-sm text-slate-400">None found.</p>
                  ) : (
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                          <th className="px-4 py-2 font-medium">Partner</th>
                          <th className="px-4 py-2 font-medium">Role</th>
                          <th className="px-4 py-2 text-right font-medium">Allocated income</th>
                          <th className="px-4 py-2 text-right font-medium">%</th>
                          <th className="px-4 py-2 text-right font-medium">Check</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {owners.map((o, i) => (
                          <tr key={i}>
                            <td className="px-4 py-2 text-slate-700">
                              {o.name}
                              {o.taxIdLast4 && (
                                <span className="ml-2 text-xs text-slate-400">{o.taxIdLast4}</span>
                              )}
                            </td>
                            <td className="px-4 py-2 text-slate-500">{o.role ?? "—"}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                              {money(o.allocatedIncome, ccy)}
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                              {o.ownershipPct != null ? `${o.ownershipPct}%` : "—"}
                            </td>
                            <td className="px-4 py-2 text-right">
                              <ReconBadge rec={reconcile(o)} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              </div>
            </section>
          );
        })
      )}

      {distReceived.length > 0 && (
        <div>
          <div className="mb-1 text-sm font-medium text-slate-700">
            Profit distributions (QBO) — outside the K-1
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Investee (issuer)</th>
                  <th className="px-4 py-2 text-right font-medium">Booked here (1099 — not K1)</th>
                  <th className="px-4 py-2 text-right font-medium">
                    Distributed per issuer&apos;s QBO
                  </th>
                  <th className="px-4 py-2 text-right font-medium">Check</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {distReceived.map((e, i) => (
                  <tr key={i}>
                    <td className="px-4 py-2 text-slate-700">
                      {e.issuerId ? (
                        <Link
                          href={`/companies/${e.issuerId}/year/${year}`}
                          className="text-[#1f3a5f] hover:underline"
                        >
                          {e.issuerName}
                        </Link>
                      ) : (
                        e.issuerName
                      )}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                      {money(e.bookedByRecipient, ccy)}
                    </td>
                    <td className="px-4 py-2 text-right tabular-nums text-slate-500">
                      {e.paidByIssuer != null ? money(e.paidByIssuer, ccy) : "—"}
                    </td>
                    <td className="px-4 py-2 text-right">
                      <DistBadge status={e.status} year={year} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-slate-200 bg-slate-50/60">
                <tr>
                  <td className="px-4 py-2 font-medium text-slate-700">
                    Total profit distributions received
                  </td>
                  <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                    {money(
                      distReceived.reduce((s, e) => s + e.bookedByRecipient, 0),
                      ccy,
                    )}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-1 text-xs text-slate-400">
            Profit the investee <strong>deducted on its own P&amp;L</strong> and paid out as a 1099
            distribution (not a K-1) — clear in the QBO books, not in the return. The subsidiary
            excluded it from your K-1, so booking it here as income is correct: <strong>not</strong>{" "}
            a double-count. &ldquo;Matched&rdquo; = the issuer&apos;s QBO shows the same payment to
            you.
          </p>
        </div>
      )}

      <YearNoteField
        companyId={id}
        year={year}
        initialBody={yearNote?.body ?? ""}
        updatedLabel={
          yearNote ? yearNote.updatedAt.toISOString().slice(0, 16).replace("T", " ") : null
        }
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-700">{children}</div>
    </div>
  );
}

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-800">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function CmpBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    match: { label: "matches ✓", cls: "bg-green-50 text-green-700" },
    reconciled: { label: "reconciles ✓", cls: "bg-emerald-50 text-emerald-700" },
    diff: { label: "differs", cls: "bg-red-50 text-red-700" },
    irOnly: { label: "not in books", cls: "bg-amber-50 text-amber-700" },
    qboOnly: { label: "not on IR", cls: "bg-amber-50 text-amber-700" },
    none: { label: "no data", cls: "bg-slate-100 text-slate-400" },
  };
  const m = map[status];
  return m ? (
    <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${m.cls}`}>{m.label}</span>
  ) : null;
}

function K1Badge({ status, year }: { status: string; year: number }) {
  const map: Record<string, { label: string; cls: string }> = {
    validated: { label: "validated ✓", cls: "bg-green-50 text-green-700" },
    differs: { label: "differs", cls: "bg-red-50 text-red-700" },
    distribution: { label: "profit distribution — see QBO", cls: "bg-slate-100 text-slate-500" },
    missing: { label: `awaiting ${year} return`, cls: "bg-amber-50 text-amber-700" },
    noAlloc: { label: "filer not on issuer's K-1", cls: "bg-amber-50 text-amber-700" },
    unregistered: { label: "not registered", cls: "bg-slate-100 text-slate-500" },
  };
  const m = map[status];
  return m ? (
    <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${m.cls}`}>{m.label}</span>
  ) : null;
}

function DistBadge({ status, year }: { status: string; year: number }) {
  const map: Record<string, { label: string; cls: string }> = {
    matched: { label: "matched ✓", cls: "bg-green-50 text-green-700" },
    amountDiff: { label: "differs", cls: "bg-red-50 text-red-700" },
    issuerNotLoaded: { label: `awaiting ${year} QBO`, cls: "bg-amber-50 text-amber-700" },
  };
  const m = map[status];
  return m ? (
    <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${m.cls}`}>{m.label}</span>
  ) : null;
}

function ReconBadge({ rec }: { rec: { status: string; pct?: number } }) {
  const map: Record<string, { label: string; cls: string }> = {
    match: { label: "matches ownership ✓", cls: "bg-green-50 text-green-700" },
    diff: { label: `differs (registered ${rec.pct}%)`, cls: "bg-red-50 text-red-700" },
    missing: { label: "not a registered owner", cls: "bg-amber-50 text-amber-700" },
    registered: { label: `registered ${rec.pct}%`, cls: "bg-slate-100 text-slate-500" },
    none: { label: "no ownership on file", cls: "bg-slate-100 text-slate-400" },
  };
  const m = map[rec.status];
  return m ? (
    <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${m.cls}`}>{m.label}</span>
  ) : null;
}
