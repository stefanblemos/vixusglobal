import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { labelForTaxTreatment, labelForJurisdiction } from "@/lib/catalog";
import { normalizeName } from "@/lib/qbo/match";

type Owner = {
  name: string;
  taxIdLast4: string | null;
  ownershipPct: number | null;
  allocatedIncome: number | null;
  role: string | null;
};

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
                <Kpi label="Ordinary income" value={money(r.ordinaryIncome, ccy)} />
                <Kpi label="Total income" value={money(r.totalIncome, ccy)} />
                <Kpi label="Net income" value={money(r.netIncome, ccy)} />
                <Kpi label="Depreciation (GL)" value={money(depTotal, ccy)} />
              </div>

              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-3">
                <Field label="EIN / Tax ID">{r.taxId ?? "—"}</Field>
                <Field label="Location">
                  {r.state ? `${r.city ? `${r.city}, ` : ""}${r.state}` : "—"}
                </Field>
                <Field label="Responsible">{r.responsible ?? "—"}</Field>
                <Field label="Preparer">{r.preparer ?? "—"}</Field>
                <Field label="Confidence">{r.confidence ?? "—"}</Field>
                <Field label="File">
                  {r.pdfSize != null ? `${r.fileName} (stored)` : `${r.fileName} (no PDF)`}
                </Field>
              </div>

              {r.summary && (
                <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
                  {r.summary}
                </div>
              )}

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
