import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { labelForTaxTreatment, labelForJurisdiction } from "@/lib/catalog";
import { normalizeName } from "@/lib/qbo/match";
import { pnlTotals } from "@/lib/qbo/pnl";

type Owner = {
  name: string;
  taxIdLast4: string | null;
  ownershipPct: number | null;
  allocatedIncome: number | null;
  role: string | null;
};

type Figure = { key: string; label: string; value: number | null; line: string | null };

const money = (v: unknown, ccy = "USD") =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: ccy,
        maximumFractionDigits: 0,
      }).format(Number(v));

export default async function CompanyYearPage({
  params,
}: {
  params: Promise<{ id: string; year: string }>;
}) {
  const { id, year: yearStr } = await params;
  const year = parseInt(yearStr, 10);

  const [company, taxReturns, taxStatus, ownerships, parties, companies] = await Promise.all([
    prisma.company.findUnique({ where: { id } }),
    prisma.taxReturn.findMany({ where: { companyId: id, year }, omit: { pdf: true } }),
    prisma.companyTaxStatus.findFirst({ where: { companyId: id, year } }),
    prisma.ownership.findMany({ where: { ownedCompanyId: id } }),
    prisma.party.findMany(),
    prisma.company.findMany(),
  ]);
  if (!company) notFound();

  const partyById = new Map(parties.map((p) => [p.id, p.name]));
  const companyById = new Map(companies.map((c) => [c.id, c.legalName]));
  const registered = ownerships
    .map((o) => ({
      name: o.ownerPartyId
        ? partyById.get(o.ownerPartyId)
        : companyById.get(o.ownerCompanyId ?? ""),
      pct: Number(o.percentage),
    }))
    .filter((r): r is { name: string; pct: number } => !!r.name);

  function reconcile(partner: Owner) {
    if (registered.length === 0) return { status: "none" as const };
    const hit = registered.find((r) => normalizeName(r.name) === normalizeName(partner.name));
    if (!hit) return { status: "missing" as const };
    if (partner.ownershipPct == null) return { status: "registered" as const, pct: hit.pct };
    return Math.abs(hit.pct - partner.ownershipPct) <= 0.5
      ? { status: "match" as const, pct: hit.pct }
      : { status: "diff" as const, pct: hit.pct };
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

          // Não-dedutíveis (Schedule K 18c / M-1): chave nova ou, p/ registros antigos, por rótulo.
          const nonDeductible =
            figVal("NON_DEDUCTIBLE") ??
            figures.find((f) => /nondeduct|n[aã]o.?dedut/i.test(f.label))?.value ??
            null;
          const irRevenue = figVal("GROSS_RECEIPTS");
          const irCogs = figVal("COST_OF_GOODS");
          const irGrossProfit = irRevenue != null ? irRevenue - (irCogs ?? 0) : null;
          const irTotalIncome = figVal("TOTAL_INCOME");
          // Other income do IR = Total income (linha 8) − Gross profit (= soma das linhas 4–7),
          // robusto a como a IA classificou cada linha (ex.: linha 4 "from other partnerships").
          const irOtherIncome =
            irTotalIncome != null && irGrossProfit != null
              ? irTotalIncome - irGrossProfit
              : figVal("OTHER_INCOME");
          // Ordinary business income = linha 22 (pelo rótulo), não o 1º match de ORDINARY_INCOME.
          const irOrdinary =
            figures.find((f) => /ordinary business income/i.test(f.label))?.value ??
            figVal("ORDINARY_INCOME");
          const irBookNet = figVal("NET_INCOME") ?? irOrdinary;
          // Renda que está no IR mas não nos books (M-1 linha 2): tipicamente lucro
          // alocado por K-1 de uma sociedade investida além do caixa distribuído.
          // Só vira ponte se o gap for material (acima da tolerância de comparação);
          // diferenças de centavos são arredondamento, não um item de conciliação.
          const otherIncomeBridge =
            irOtherIncome != null &&
            pnl.otherIncome != null &&
            irOtherIncome - pnl.otherIncome > Math.max(1, Math.abs(irOtherIncome) * 0.01)
              ? irOtherIncome - pnl.otherIncome
              : null;
          const qboOrdinary =
            pnl.netIncome != null
              ? pnl.netIncome + (nonDeductible ?? 0) + (otherIncomeBridge ?? 0)
              : null;
          const pnlHref = pnlImport ? `/import/${pnlImport.id}` : undefined;

          // reconcilesWith: diferença "esperada" que é explicada por um item conhecido
          // (livro × imposto). Se o gap real bate com ele, a linha conta como conciliada.
          const cmpRows: {
            label: string;
            ir: number | null;
            qbo: number | null;
            href?: string;
            strong?: boolean;
            taxOnly?: boolean;
            reconcilesWith?: number | null;
            note?: string;
          }[] = [
            { label: "Gross receipts / revenue", ir: irRevenue, qbo: pnl.revenue, href: pnlHref },
            { label: "Cost of goods sold", ir: irCogs, qbo: pnl.cogs, href: pnlHref },
            { label: "Gross profit", ir: irGrossProfit, qbo: pnl.grossProfit, href: pnlHref },
            {
              label: "Total deductions / expenses",
              ir: figVal("TOTAL_DEDUCTIONS"),
              qbo: pnl.expenses,
              href: pnlHref,
              // QBO inclui as despesas cheias; o IR já tira a não-dedutível → o gap É ela.
              reconcilesWith: nonDeductible,
              note: nonDeductible != null ? "gap = non-deductible add-back" : undefined,
            },
            {
              label: "Other income",
              ir: irOtherIncome,
              qbo: pnl.otherIncome,
              href: pnlHref,
              reconcilesWith: otherIncomeBridge != null ? -otherIncomeBridge : null,
              note: otherIncomeBridge != null ? "K-1 allocated vs cash (→ M-1 below)" : undefined,
            },
            {
              label: "Net income (per books)",
              ir: irBookNet,
              qbo: pnl.netIncome,
              href: pnlHref,
              strong: true,
              reconcilesWith: otherIncomeBridge != null ? -otherIncomeBridge : null,
              note: otherIncomeBridge != null ? "gap = K-1 timing (see M-1 below)" : undefined,
            },
            { label: "+ Non-deductible expenses", ir: nonDeductible, qbo: null, taxOnly: true },
            ...(otherIncomeBridge != null
              ? [
                  {
                    label: "+ Income on return not on books (M-1 line 2)",
                    ir: otherIncomeBridge,
                    qbo: null,
                    taxOnly: true,
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
              href: depTotal != null ? `/ledger?company=${id}` : undefined,
            },
          ];
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

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <Kpi
                  label="Total income"
                  value={money(figVal("TOTAL_INCOME") ?? r.totalIncome, ccy)}
                />
                <Kpi label="Taxable income" value={money(figVal("TAXABLE_INCOME"), ccy)} />
                <Kpi label="Total tax" value={money(figVal("TOTAL_TAX"), ccy)} />
                <Kpi label="Depreciation (GL)" value={money(depTotal, ccy)} />
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
                        {figures.map((f, i) => (
                          <tr key={i}>
                            <td className="px-4 py-2 text-slate-700">{f.label}</td>
                            <td className="px-4 py-2 text-slate-400">{f.line ?? "—"}</td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                              {money(f.value, ccy)}
                            </td>
                          </tr>
                        ))}
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
                        const c = row.taxOnly ? null : compare(row.ir, row.qbo);
                        // Diferença explicada por um item conhecido → conta como conciliada.
                        const reconciled =
                          !!c &&
                          c.status === "diff" &&
                          "diff" in c &&
                          c.diff != null &&
                          row.reconcilesWith != null &&
                          Math.abs(c.diff - row.reconcilesWith) <=
                            Math.max(1, Math.abs(row.reconcilesWith) * 0.02);
                        const status = reconciled ? "reconciled" : c?.status;
                        return (
                          <tr key={row.label} className={row.strong ? "bg-slate-50/40" : ""}>
                            <td
                              className={`px-4 py-2 ${row.strong ? "font-medium text-slate-800" : "text-slate-700"}`}
                            >
                              {row.label}
                              {row.note && (
                                <span className="block text-xs font-normal text-slate-400">
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
                              {row.taxOnly ? (
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
                            <td className="py-1.5 text-slate-700">Total per QBO books (cash)</td>
                            <td className="py-1.5 text-right tabular-nums text-slate-800">
                              {money(pnl.otherIncome, ccy)}
                            </td>
                          </tr>
                          <tr>
                            <td className="py-1.5 text-slate-600">
                              Per the IR — other income (Form 1065 lines 4–7)
                            </td>
                            <td className="py-1.5 text-right tabular-nums text-slate-600">
                              {money(irOtherIncome, ccy)}
                            </td>
                          </tr>
                          {otherIncomeBridge != null && (
                            <tr className="font-medium text-emerald-700">
                              <td className="py-1.5">
                                Allocated on K-1 but not distributed in cash (M-1 line 2)
                              </td>
                              <td className="py-1.5 text-right tabular-nums">
                                {money(otherIncomeBridge, ccy)}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                      <p className="mt-2 text-xs text-slate-400">
                        The books record the cash actually distributed by the investee; the return
                        reports this company&rsquo;s allocated share of the investee&rsquo;s income
                        (K-1). The difference is undistributed earnings — a normal book-vs-tax
                        timing item, not necessarily an error. Confirm against the investee&rsquo;s
                        K-1.
                      </p>
                    </div>
                  </details>
                )}
              </div>

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

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-800">{value}</div>
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
