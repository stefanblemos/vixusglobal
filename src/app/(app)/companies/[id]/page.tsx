import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AddOwnerForm } from "@/components/add-owner-form";
import { OwnershipRowActions } from "@/components/ownership-row-actions";
import { TaxStatusForm } from "@/components/tax-status-form";
import { deleteTaxStatus } from "@/lib/actions/tax";
import {
  labelForEntityType,
  labelForJurisdiction,
  labelForRelationship,
  labelForTaxTreatment,
} from "@/lib/catalog";
import { computeEffectiveOwners, edgesFromOwnerships } from "@/lib/ownership/effective";
import { buildFixedAssetRegister } from "@/lib/assets/register";
import { qboPeriodKey } from "@/lib/qbo/period";
import { companyReserve } from "@/lib/tax/reserve";

const fmtPct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}%`;
const fmtDate = (d: Date | null | undefined) =>
  d
    ? d.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;
// Período de vigência de um vínculo (entrada → saída), legível.
const ownPeriod = (o: { effectiveDate: Date | null; endDate: Date | null }) =>
  `${fmtDate(o.effectiveDate) ?? "since start"} → ${fmtDate(o.endDate) ?? "current"}`;
const money = (v: unknown, ccy = "USD") =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: ccy,
        maximumFractionDigits: 0,
      }).format(Number(v));

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "ownership", label: "Ownership" },
  { key: "history", label: "History & Tax" },
  { key: "estimated-tax", label: "Estimated tax" },
  { key: "financials", label: "Financials" },
  { key: "assets", label: "Assets" },
] as const;

export default async function CompanyDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; year?: string }>;
}) {
  const { id } = await params;
  const { tab: tabRaw, year: yearRaw } = await searchParams;
  const tab = TABS.some((t) => t.key === tabRaw) ? tabRaw! : "overview";

  const [
    company,
    parties,
    companies,
    ownerships,
    taxStatuses,
    taxReturns,
    glCount,
    bankStatements,
    loans,
    qboImports,
    yearCloses,
  ] = await Promise.all([
    prisma.company.findUnique({ where: { id } }),
    prisma.party.findMany({ orderBy: { name: "asc" } }),
    prisma.company.findMany({ orderBy: { legalName: "asc" } }),
    prisma.ownership.findMany(),
    prisma.companyTaxStatus.findMany({ where: { companyId: id }, orderBy: { year: "desc" } }),
    prisma.taxReturn.findMany({
      where: { companyId: id },
      orderBy: { year: "desc" },
      omit: { pdf: true },
    }),
    prisma.ledgerTxn.count({ where: { companyId: id } }),
    prisma.bankStatement.findMany({ where: { companyId: id }, orderBy: { periodEnd: "desc" } }),
    prisma.intercompanyLoan.findMany({
      where: { OR: [{ lenderCompanyId: id }, { borrowerCompanyId: id }] },
      include: { lender: true, borrower: true },
    }),
    prisma.qboImport.findMany({ where: { companyId: id }, orderBy: { createdAt: "desc" } }),
    prisma.yearClose.findMany({ where: { companyId: id }, select: { year: true } }),
  ]);

  if (!company) notFound();

  const lockedYears = new Set(yearCloses.map((y) => y.year));

  const partyById = new Map(parties.map((p) => [p.id, p]));
  const companyById = new Map(companies.map((c) => [c.id, c]));
  const nameOf = (type: "party" | "company", entId: string) =>
    type === "party"
      ? (partyById.get(entId)?.name ?? "—")
      : (companyById.get(entId)?.legalName ?? "—");

  const directOwners = ownerships
    .filter((o) => o.ownedCompanyId === id)
    .map((o) => {
      const type = o.ownerPartyId ? ("party" as const) : ("company" as const);
      const entId = o.ownerPartyId ?? o.ownerCompanyId!;
      return {
        id: o.id,
        type,
        name: nameOf(type, entId),
        percentage: Number(o.percentage),
        shareClass: o.shareClass,
        effectiveDate: o.effectiveDate,
        endDate: o.endDate,
      };
    })
    .sort((a, b) => b.percentage - a.percentage);

  // Um vínculo está ativo no ano Y se entrou até o fim do ano e não saiu antes do início.
  const yStart = (y: number) => new Date(`${y}-01-01T00:00:00Z`);
  const yEnd = (y: number) => new Date(`${y}-12-31T23:59:59Z`);
  const activeInYear = (
    o: { effectiveDate: Date | null; endDate: Date | null },
    y: number,
  ): boolean =>
    (!o.effectiveDate || o.effectiveDate <= yEnd(y)) && (!o.endDate || o.endDate >= yStart(y));

  // Anos para o seletor de ownership: do mais antigo (entrada de algum sócio ou ano de
  // IR) até o atual, contínuo.
  const ownerYearMarks = directOwners
    .map((o) => o.effectiveDate?.getUTCFullYear())
    .filter((y): y is number => y != null);
  const currentYear = new Date().getFullYear();
  const earliestOwnYear = Math.min(currentYear, ...ownerYearMarks);
  const ownershipYears: number[] = [];
  for (let y = currentYear; y >= earliestOwnYear; y--) ownershipYears.push(y);
  const ownYear =
    yearRaw && Number(yearRaw) >= earliestOwnYear && Number(yearRaw) <= currentYear
      ? Number(yearRaw)
      : currentYear;

  const holdings = ownerships
    .filter((o) => o.ownerCompanyId === id)
    .map((o) => {
      const type = o.ownedCompanyId ? ("company" as const) : ("party" as const);
      const entId = o.ownedCompanyId ?? o.ownedPartyId!;
      return { id: o.id, type, name: nameOf(type, entId), percentage: Number(o.percentage) };
    })
    .sort((a, b) => b.percentage - a.percentage);

  // UBO calculado COMO ESTAVA no fim do ano selecionado (as-of), p/ seguir o IR.
  const edges = edgesFromOwnerships(ownerships, yEnd(ownYear));
  const {
    owners: ubo,
    coverage,
    hasCycle,
  } = computeEffectiveOwners("company", id, edges, {
    ultimateOnly: true,
  });
  const directOwnersInYear = directOwners.filter((o) => activeInYear(o, ownYear));
  // Donos vigentes HOJE (p/ o snapshot da aba Overview).
  const currentOwners = directOwners.filter((o) => activeInYear(o, currentYear));

  const ownerOptions = [
    ...parties.map((p) => ({ value: `party:${p.id}`, label: p.name, group: "Owners" })),
    ...companies
      .filter((c) => c.id !== id)
      .map((c) => ({ value: `company:${c.id}`, label: c.legalName, group: "Companies" })),
  ];

  // ── Estimated tax tab ──
  const pnlYears = [
    ...new Set(
      qboImports
        .filter((i) => i.reportKind === "PROFIT_AND_LOSS")
        .map((i) => {
          const m = i.periodLabel.match(/(20\d\d)/);
          return m ? Number(m[1]) : null;
        })
        .filter((y): y is number => y != null),
    ),
  ].sort((a, b) => b - a);
  const estYear =
    yearRaw && pnlYears.includes(Number(yearRaw))
      ? Number(yearRaw)
      : (pnlYears[0] ?? new Date().getFullYear());
  const treatment = (taxStatuses.find((t) => t.year === estYear)?.taxTreatment ??
    taxReturns.find((t) => t.year === estYear)?.taxTreatment ??
    null) as string | null;
  const passThrough = ["PARTNERSHIP", "S_CORP", "DISREGARDED", "SOLE_PROP"].includes(
    treatment ?? "",
  );
  const estimate = tab === "estimated-tax" ? await companyReserve(id, estYear) : null;
  // P/ o split da reserva uso o snapshot de FIM do ano (soma 100%); num ano de transição
  // a aba Ownership é que mostra todos os sócios com seus períodos.
  const ownersForEst = directOwners.filter(
    (o) =>
      (!o.effectiveDate || o.effectiveDate <= yEnd(estYear)) &&
      (!o.endDate || o.endDate > yEnd(estYear)),
  );

  // Histórico por ano (montado a partir dos documentos): tributação + IRs arquivados.
  const taxByYear = new Map(taxStatuses.map((t) => [t.year, t]));
  const returnsByYear = new Map<number, typeof taxReturns>();
  for (const r of taxReturns) {
    if (r.year == null) continue;
    const arr = returnsByYear.get(r.year) ?? [];
    arr.push(r);
    returnsByYear.set(r.year, arr);
  }
  const historyYears = [
    ...new Set([
      ...taxStatuses.map((t) => t.year),
      ...taxReturns.map((r) => r.year).filter((y): y is number => y != null),
    ]),
  ].sort((a, b) => b - a);

  // O raio-x atual usa sempre o relatório de PERÍODO mais recente (não o último importado),
  // p/ que subir um BS antigo não apague os assets/saldos do ano corrente.
  const byPeriodDesc = (a: { periodLabel: string }, b: { periodLabel: string }) =>
    qboPeriodKey(b.periodLabel) - qboPeriodKey(a.periodLabel);
  const latestBS =
    qboImports.filter((q) => q.reportKind === "BALANCE_SHEET").sort(byPeriodDesc)[0] ?? null;
  const bsLines = latestBS
    ? await prisma.qboImportLine.findMany({ where: { importId: latestBS.id } })
    : [];
  const bsSubject = (label: string) => {
    const m = label.match(/^total\s+(?:(?:for|para|do|da|de)\s+)?(.+)$/i);
    return (m?.[1] ?? label.replace(/^total\s+/i, "")).trim().toLowerCase();
  };
  const bsTotal = (key: string) => {
    const l = bsLines.find((x) => x.lineType === "TOTAL" && bsSubject(x.label) === key);
    return l?.value != null ? Number(l.value) : null;
  };
  const bs = latestBS
    ? {
        assets: bsTotal("assets"),
        liabilities: bsTotal("liabilities"),
        equity: bsTotal("equity"),
        period: latestBS.periodLabel,
      }
    : null;
  const assetReg = buildFixedAssetRegister(bsLines);

  // Despesa de depreciação por ano (do GL) — para conferir contra o IR.
  const depTxns = await prisma.ledgerTxn.findMany({
    where: {
      companyId: id,
      account: { contains: "epreciat" },
      NOT: { account: { contains: "ccumulated" } },
    },
    select: { date: true, amount: true },
  });
  const depByYear = new Map<number, number>();
  for (const t of depTxns) {
    const y = t.date.getUTCFullYear();
    depByYear.set(y, (depByYear.get(y) ?? 0) + Number(t.amount));
  }
  const depYears = [...depByYear.keys()].sort((a, b) => b - a);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/companies" className="text-sm text-slate-500 hover:text-slate-700">
          ← Companies
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">{company.legalName}</h1>
        {company.aliases.length > 0 && (
          <p className="mt-1 text-sm text-slate-400">Formerly: {company.aliases.join(", ")}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <Chip>{labelForEntityType(company.entityType)}</Chip>
          <Chip>
            {labelForJurisdiction(company.jurisdiction)}
            {company.state ? ` · ${company.state}` : ""}
          </Chip>
          <Chip>{labelForRelationship(company.relationship)}</Chip>
          <Chip>{company.baseCurrency}</Chip>
          {company.taxId && <Chip>Tax ID {company.taxId}</Chip>}
        </div>
      </div>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/companies/${id}?tab=${t.key}`}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
              tab === t.key
                ? "border-[#1f3a5f] text-[#1f3a5f]"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {/* ───────── Overview ───────── */}
      {tab === "overview" && (
        <div className="space-y-6">
          {bs && (
            <div>
              <div className="grid grid-cols-3 gap-3">
                <Kpi label="Total assets" value={money(bs.assets, company.baseCurrency)} />
                <Kpi
                  label="Total liabilities"
                  value={money(bs.liabilities, company.baseCurrency)}
                />
                <Kpi label="Total equity" value={money(bs.equity, company.baseCurrency)} />
              </div>
              <p className="mt-1 text-xs text-slate-400">
                Latest balance sheet (QBO) · {bs.period}
              </p>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Direct owners" value={`${currentOwners.length}`} />
            <Kpi
              label="UBO coverage"
              value={ubo.length ? fmtPct(coverage) : "—"}
              warn={ubo.length > 0 && coverage < 99.99}
            />
            <Kpi label="Years on file" value={`${historyYears.length}`} />
            <Kpi label="GL transactions" value={glCount.toLocaleString("en-US")} />
            <Kpi label="Tax returns (IR)" value={`${taxReturns.length}`} />
            <Kpi label="QBO reports" value={`${qboImports.length}`} />
            <Kpi label="Loans" value={`${loans.length}`} />
            <Kpi label="Bank statements" value={`${bankStatements.length}`} />
          </div>

          <section className="grid gap-4 md:grid-cols-2">
            <Card title="Ownership">
              {currentOwners.length === 0 ? (
                <p className="text-sm text-slate-500">No owners linked yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {currentOwners.map((o) => (
                    <li key={o.id} className="flex justify-between">
                      <span className="text-slate-700">{o.name}</span>
                      <span className="tabular-nums text-slate-800">{fmtPct(o.percentage)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <TabLink id={id} tab="ownership">
                View ownership & UBO →
              </TabLink>
            </Card>

            <Card title="Latest documents">
              <ul className="space-y-1 text-sm text-slate-600">
                {taxReturns[0] && (
                  <li>
                    IR {taxReturns[0].year}: {taxReturns[0].taxForm ?? taxReturns[0].fileName}
                  </li>
                )}
                {qboImports[0] && (
                  <li>
                    QBO: {qboImports[0].reportTypeLabel} ({qboImports[0].periodLabel})
                  </li>
                )}
                {bankStatements[0] && <li>Bank: {bankStatements[0].bankLabel}</li>}
                {taxReturns.length === 0 &&
                  qboImports.length === 0 &&
                  bankStatements.length === 0 && (
                    <li className="text-slate-400">No documents yet.</li>
                  )}
              </ul>
            </Card>
          </section>

          <section className="flex flex-wrap gap-2">
            <Quick href={`/ledger?company=${id}`}>Ledger</Quick>
            <Quick href={`/audit?company=${id}`}>Audit (variations)</Quick>
            <Quick href="/bank">Bank</Quick>
            <Quick href="/exposure">Loan exposure</Quick>
            <Quick href="/tax">Tax / IR</Quick>
          </section>
        </div>
      )}

      {/* ───────── Ownership ───────── */}
      {tab === "ownership" && (
        <div className="space-y-8">
          <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-lg font-medium text-slate-800">Direct owners · {ownYear}</h2>
                <p className="text-sm text-slate-500">
                  Who held a stake during {ownYear} — entries and exits included, each with its
                  period. Pick a year to follow the tax return&apos;s reasoning.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
                {ownershipYears.map((y) => (
                  <Link
                    key={y}
                    href={`/companies/${id}?tab=ownership&year=${y}`}
                    className={`rounded-md px-2.5 py-1 text-sm ${
                      y === ownYear
                        ? "bg-[#1f3a5f] font-medium text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {y}
                  </Link>
                ))}
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {directOwnersInYear.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No owners on record for {ownYear}.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Owner</th>
                      <th className="px-4 py-3 font-medium">Type</th>
                      <th className="px-4 py-3 font-medium">Period held</th>
                      <th className="px-4 py-3 text-right font-medium">Ownership</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {directOwnersInYear.map((o) => (
                      <tr key={o.id}>
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {o.name}
                          {o.shareClass && (
                            <span className="ml-2 text-xs font-normal text-slate-400">
                              {o.shareClass}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {o.type === "party" ? "Owner" : "Company"}
                        </td>
                        <td className="px-4 py-3 text-xs text-slate-500">{ownPeriod(o)}</td>
                        <td className="px-4 py-3 text-right text-slate-800">
                          {fmtPct(o.percentage)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <OwnershipRowActions
                            ownershipId={o.id}
                            companyId={id}
                            ended={!!o.endDate}
                            defaultEndDate={`${ownYear}-12-31`}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <AddOwnerForm
                companyId={id}
                options={ownerOptions}
                defaultEffectiveDate={`${ownYear}-01-01`}
              />
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-medium text-slate-800">
                Ultimate beneficial owners (UBO) · as of Dec 31, {ownYear}
              </h2>
              {coverage < 99.99 && (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">
                  Coverage {fmtPct(coverage)} — incomplete ownership
                </span>
              )}
              {hasCycle && (
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs text-amber-700">
                  Cross-holding detected
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500">
              Effective ownership across the full chain, down to the final individuals/entities.
            </p>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {ubo.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">
                  Not enough data — link owners to compute the UBO.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Ultimate owner</th>
                      <th className="px-4 py-3 text-right font-medium">Effective ownership</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ubo.map((o) => (
                      <tr key={o.key}>
                        <td className="px-4 py-3 font-medium text-slate-800">
                          {nameOf(o.type, o.id)}
                        </td>
                        <td className="px-4 py-3 text-right text-slate-800">
                          {fmtPct(o.percentage)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          {holdings.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-medium text-slate-800">This company&apos;s holdings</h2>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {holdings.map((h) => (
                      <tr key={h.id}>
                        <td className="px-4 py-3 font-medium text-slate-800">{h.name}</td>
                        <td className="px-4 py-3 text-right text-slate-800">
                          {fmtPct(h.percentage)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}

      {/* ───────── History & Tax ───────── */}
      {tab === "history" && (
        <div className="space-y-8">
          <section className="space-y-3">
            <h2 className="text-lg font-medium text-slate-800">History by year</h2>
            <p className="text-sm text-slate-500">
              The company&apos;s situation each year, built from the filed documents (tax
              classification + income tax returns). Ownership and address per year will join here.
            </p>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {historyYears.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No yearly history yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Year</th>
                      <th className="px-4 py-3 font-medium">Entity type</th>
                      <th className="px-4 py-3 font-medium">Tax treatment</th>
                      <th className="px-4 py-3 font-medium">Tax return on file</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {historyYears.map((y) => {
                      const ts = taxByYear.get(y);
                      const rs = returnsByYear.get(y) ?? [];
                      const ir = rs[0];
                      return (
                        <tr key={y} className="hover:bg-slate-50">
                          <td className="px-4 py-3 font-medium">
                            <Link
                              href={`/companies/${id}/year/${y}`}
                              className="text-[#1f3a5f] hover:underline"
                            >
                              {y}
                            </Link>
                            {lockedYears.has(y) && (
                              <span
                                title="Year locked"
                                className="ml-2 rounded-full bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-700"
                              >
                                🔒
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {ts ? labelForEntityType(ts.entityType) : (ir?.entityType ?? "—")}
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {ts ? (
                              labelForTaxTreatment(ts.taxTreatment)
                            ) : ir?.taxTreatment ? (
                              <>
                                {labelForTaxTreatment(ir.taxTreatment)}{" "}
                                <span className="text-xs text-slate-400">(from IR)</span>
                              </>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-4 py-3 text-slate-500">
                            {rs.length === 0
                              ? "—"
                              : rs.map((r, i) => (
                                  <span key={r.id}>
                                    {i > 0 && ", "}
                                    {r.pdfSize != null ? (
                                      <a
                                        href={`/api/tax-returns/${r.id}/pdf`}
                                        target="_blank"
                                        rel="noopener"
                                        className="text-[#1f3a5f] hover:underline"
                                      >
                                        {r.taxForm ?? r.fileName}
                                      </a>
                                    ) : (
                                      <Link href="/tax" className="text-[#1f3a5f] hover:underline">
                                        {r.taxForm ?? r.fileName}
                                      </Link>
                                    )}
                                  </span>
                                ))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-slate-800">Tax classification by year</h2>
            <p className="text-sm text-slate-500">
              Legal type and how the company was taxed each year (it can change over time).
            </p>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {taxStatuses.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No tax classification recorded yet.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Year</th>
                      <th className="px-4 py-3 font-medium">Entity type</th>
                      <th className="px-4 py-3 font-medium">Tax treatment</th>
                      <th className="px-4 py-3 font-medium">Notes</th>
                      <th className="px-4 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {taxStatuses.map((t) => (
                      <tr key={t.id}>
                        <td className="px-4 py-3 font-medium text-slate-800">{t.year}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {labelForEntityType(t.entityType)}
                        </td>
                        <td className="px-4 py-3 text-slate-700">
                          {labelForTaxTreatment(t.taxTreatment)}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{t.notes ?? "—"}</td>
                        <td className="px-4 py-3 text-right">
                          <form action={deleteTaxStatus}>
                            <input type="hidden" name="id" value={t.id} />
                            <input type="hidden" name="companyId" value={id} />
                            <button className="text-xs text-slate-400 hover:text-red-600">
                              Remove
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <TaxStatusForm companyId={id} defaultEntityType={company.entityType} />
            </div>
          </section>
        </div>
      )}

      {/* ───────── Estimated tax ───────── */}
      {tab === "estimated-tax" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-medium text-slate-800">Estimated tax · {estYear}</h2>
            {pnlYears.length > 0 && (
              <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-1">
                {pnlYears.map((y) => (
                  <Link
                    key={y}
                    href={`/companies/${id}?tab=estimated-tax&year=${y}`}
                    className={`rounded-md px-2.5 py-1 text-sm ${
                      y === estYear
                        ? "bg-[#1f3a5f] font-medium text-white"
                        : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    {y}
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div
            className={`rounded-xl border px-4 py-3 text-sm ${
              passThrough ? "border-amber-200 bg-amber-50/40" : "border-slate-200 bg-white"
            }`}
          >
            {treatment ? (
              passThrough ? (
                <>
                  <span className="font-medium text-slate-800">
                    {labelForTaxTreatment(treatment)} — pass-through.
                  </span>{" "}
                  This company doesn&apos;t pay income tax itself. Its profit passes to the partners
                  below, who owe the tax on their own returns — the reserve is what to set aside so
                  the cash is ready.
                </>
              ) : (
                <>
                  <span className="font-medium text-slate-800">
                    {labelForTaxTreatment(treatment)} — taxed at the entity.
                  </span>{" "}
                  This company pays its own income tax; the reserve is for its bill.
                </>
              )
            ) : (
              <span className="text-slate-500">
                No tax treatment on file for {estYear} — using a flat reserve. Set it in History
                &amp; Tax.
              </span>
            )}
          </div>

          {estimate == null || estimate.periodLabel == null ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              No Profit &amp; Loss on file for {estYear}. Import one in{" "}
              <Link href="/import" className="text-[#1f3a5f] hover:underline">
                Documents
              </Link>
              .
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <Kpi
                  label="Estimated profit"
                  value={money(estimate.profit, company.baseCurrency)}
                  hint={estimate.periodLabel}
                />
                <Kpi
                  label="Reserve rate"
                  value={`${estimate.ratePct}%`}
                  hint={estimate.hasOverride ? "company override" : "group default"}
                />
                <Kpi
                  label="Reserve to set aside"
                  value={money(estimate.reserve, company.baseCurrency)}
                />
              </div>

              {passThrough &&
                ownersForEst.length > 0 &&
                estimate.profit != null &&
                estimate.profit > 0 && (
                  <div>
                    <div className="mb-1 text-sm font-medium text-slate-700">
                      Who owes it — by partner
                    </div>
                    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-slate-500">
                          <tr>
                            <th className="px-4 py-2 font-medium">Partner</th>
                            <th className="px-4 py-2 text-right font-medium">Share</th>
                            <th className="px-4 py-2 text-right font-medium">Profit to them</th>
                            <th className="px-4 py-2 text-right font-medium">Reserve</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {ownersForEst.map((o) => (
                            <tr key={o.id}>
                              <td className="px-4 py-2 text-slate-700">{o.name}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                                {fmtPct(o.percentage)}
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                                {money(
                                  (estimate.profit! * o.percentage) / 100,
                                  company.baseCurrency,
                                )}
                              </td>
                              <td className="px-4 py-2 text-right font-medium tabular-nums text-slate-800">
                                {money(
                                  (estimate.reserve * o.percentage) / 100,
                                  company.baseCurrency,
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">
                      Split by registered ownership %. The actual K-1 allocation can differ (special
                      allocations) — confirmed against the filed return once the year is reconciled.
                    </p>
                  </div>
                )}
            </>
          )}
        </div>
      )}

      {/* ───────── Financials ───────── */}
      {tab === "financials" && (
        <div className="space-y-6">
          <div className="flex flex-wrap gap-2">
            <Quick href={`/ledger?company=${id}`}>
              Open ledger ({glCount.toLocaleString("en-US")})
            </Quick>
            <Quick href={`/audit?company=${id}`}>Account variations</Quick>
            <Quick href="/bank">Bank reconciliation</Quick>
            <Quick href="/exposure">Loan exposure</Quick>
          </div>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-slate-800">QBO reports on file</h2>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {qboImports.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No QBO reports imported.</p>
              ) : (
                <table className="w-full text-sm">
                  <tbody className="divide-y divide-slate-100">
                    {[...qboImports].sort(byPeriodDesc).map((q) => (
                      <tr key={q.id} className="hover:bg-slate-50">
                        <td className="px-4 py-3 font-medium">
                          <Link href={`/import/${q.id}`} className="text-[#1f3a5f] hover:underline">
                            {q.reportTypeLabel}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{q.periodLabel}</td>
                        <td className="px-4 py-3 text-slate-400">{q.basis ?? ""}</td>
                        <td className="px-4 py-3 text-right">
                          <Link
                            href={`/import/${q.id}`}
                            className="text-xs text-[#1f3a5f] hover:underline"
                          >
                            Open →
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

          <section className="space-y-3">
            <h2 className="text-lg font-medium text-slate-800">Intercompany loans</h2>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {loans.length === 0 ? (
                <p className="p-6 text-sm text-slate-500">No loans involving this company.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Direction</th>
                      <th className="px-4 py-3 font-medium">Counterparty</th>
                      <th className="px-4 py-3 text-right font-medium">Principal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {loans.map((l) => {
                      const isLender = l.lenderCompanyId === id;
                      return (
                        <tr key={l.id}>
                          <td className="px-4 py-3">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs ${isLender ? "bg-green-50 text-green-700" : "bg-amber-50 text-amber-700"}`}
                            >
                              {isLender ? "Lent" : "Borrowed"}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-slate-700">
                            {isLender ? l.borrower.legalName : l.lender.legalName}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-800">
                            {money(l.principal, l.currency)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      )}

      {/* ───────── Assets ───────── */}
      {tab === "assets" && (
        <div className="space-y-6">
          {!assetReg ? (
            <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
              No fixed assets in the latest balance sheet.
            </div>
          ) : (
            <>
              <div>
                <div className="grid grid-cols-3 gap-3">
                  <Kpi label="Gross cost" value={money(assetReg.gross, company.baseCurrency)} />
                  <Kpi
                    label="Accumulated depreciation"
                    value={money(assetReg.accDep, company.baseCurrency)}
                  />
                  <Kpi label="Net book value" value={money(assetReg.net, company.baseCurrency)} />
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  Fixed assets from the latest balance sheet (QBO){bs ? ` · ${bs.period}` : ""}
                </p>
              </div>

              <section className="space-y-3">
                <h2 className="text-lg font-medium text-slate-800">Fixed asset register</h2>
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-500">
                      <tr>
                        <th className="px-4 py-3 font-medium">Asset</th>
                        <th className="px-4 py-3 text-right font-medium">Cost</th>
                        <th className="px-4 py-3 text-right font-medium">Accum. depreciation</th>
                        <th className="px-4 py-3 text-right font-medium">Net book value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {assetReg.rows.map((a, i) => (
                        <tr key={i}>
                          <td className="px-4 py-3 text-slate-700">{a.name}</td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                            {money(a.cost, company.baseCurrency)}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-500">
                            {a.accDep ? money(a.accDep, company.baseCurrency) : "—"}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-slate-800">
                            {money(a.net, company.baseCurrency)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </>
          )}

          {depYears.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-lg font-medium text-slate-800">
                Depreciation expense by year (GL)
              </h2>
              <p className="text-sm text-slate-500">
                From the general ledger — compare against the depreciation deducted on each
                year&apos;s tax return.
              </p>
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-left text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">Year</th>
                      <th className="px-4 py-3 text-right font-medium">Depreciation expense</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {depYears.map((y) => (
                      <tr key={y}>
                        <td className="px-4 py-3 font-medium text-slate-800">{y}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-800">
                          {money(depByYear.get(y), company.baseCurrency)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function Chip({ children }: { children: ReactNode }) {
  return <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">{children}</span>;
}

function Kpi({
  label,
  value,
  warn,
  hint,
}: {
  label: string;
  value: string;
  warn?: boolean;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${warn ? "text-amber-700" : "text-slate-800"}`}>
        {value}
      </div>
      {hint && <div className="mt-0.5 text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-sm font-medium text-slate-700">{title}</div>
      {children}
    </div>
  );
}

function TabLink({ id, tab, children }: { id: string; tab: string; children: ReactNode }) {
  return (
    <Link
      href={`/companies/${id}?tab=${tab}`}
      className="mt-2 inline-block text-sm text-[#1f3a5f] hover:underline"
    >
      {children}
    </Link>
  );
}

function Quick({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
    >
      {children}
    </Link>
  );
}
