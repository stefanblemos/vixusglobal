import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AddOwnerForm } from "@/components/add-owner-form";
import { TaxStatusForm } from "@/components/tax-status-form";
import { deleteOwnership } from "@/lib/actions/ownership";
import { deleteTaxStatus } from "@/lib/actions/tax";
import {
  labelForEntityType,
  labelForJurisdiction,
  labelForRelationship,
  labelForTaxTreatment,
} from "@/lib/catalog";
import { computeEffectiveOwners, edgesFromOwnerships } from "@/lib/ownership/effective";

const fmtPct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}%`;

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [company, parties, companies, ownerships, taxStatuses, taxReturns] = await Promise.all([
    prisma.company.findUnique({ where: { id } }),
    prisma.party.findMany({ orderBy: { name: "asc" } }),
    prisma.company.findMany({ orderBy: { legalName: "asc" } }),
    prisma.ownership.findMany(),
    prisma.companyTaxStatus.findMany({ where: { companyId: id }, orderBy: { year: "desc" } }),
    prisma.taxReturn.findMany({ where: { companyId: id }, orderBy: { year: "desc" } }),
  ]);

  if (!company) notFound();

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
      };
    })
    .sort((a, b) => b.percentage - a.percentage);

  const holdings = ownerships
    .filter((o) => o.ownerCompanyId === id)
    .map((o) => {
      const type = o.ownedCompanyId ? ("company" as const) : ("party" as const);
      const entId = o.ownedCompanyId ?? o.ownedPartyId!;
      return { id: o.id, type, name: nameOf(type, entId), percentage: Number(o.percentage) };
    })
    .sort((a, b) => b.percentage - a.percentage);

  const edges = edgesFromOwnerships(ownerships);
  const {
    owners: ubo,
    coverage,
    hasCycle,
  } = computeEffectiveOwners("company", id, edges, { ultimateOnly: true });

  const ownerOptions = [
    ...parties.map((p) => ({ value: `party:${p.id}`, label: p.name, group: "Owners" })),
    ...companies
      .filter((c) => c.id !== id)
      .map((c) => ({ value: `company:${c.id}`, label: c.legalName, group: "Companies" })),
  ];

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

  return (
    <div className="space-y-8">
      <div>
        <Link href="/companies" className="text-sm text-slate-500 hover:text-slate-700">
          ← Companies
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">{company.legalName}</h1>
        {company.aliases.length > 0 && (
          <p className="mt-1 text-sm text-slate-400">Formerly: {company.aliases.join(", ")}</p>
        )}
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
            {labelForEntityType(company.entityType)}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
            {labelForJurisdiction(company.jurisdiction)}
            {company.state ? ` · ${company.state}` : ""}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
            {labelForRelationship(company.relationship)}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
            {company.baseCurrency}
          </span>
          {company.taxId && (
            <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
              Tax ID {company.taxId}
            </span>
          )}
        </div>
      </div>

      {historyYears.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium text-slate-800">History by year</h2>
          <p className="text-sm text-slate-500">
            The company&apos;s situation each year, built from the filed documents (tax
            classification + income tax returns). Ownership and address per year will join here.
          </p>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
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
                  return (
                    <tr key={y}>
                      <td className="px-4 py-3 font-medium text-slate-800">{y}</td>
                      <td className="px-4 py-3 text-slate-600">
                        {ts ? labelForEntityType(ts.entityType) : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-700">
                        {ts ? labelForTaxTreatment(ts.taxTreatment) : "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {rs.length === 0 ? (
                          "—"
                        ) : (
                          <Link href="/tax" className="text-[#1f3a5f] hover:underline">
                            {rs.map((r) => r.taxForm ?? r.fileName).join(", ")}
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-800">Direct owners</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {directOwners.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No owners linked yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Owner</th>
                  <th className="px-4 py-3 font-medium">Type</th>
                  <th className="px-4 py-3 font-medium">Class</th>
                  <th className="px-4 py-3 text-right font-medium">Ownership</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {directOwners.map((o) => (
                  <tr key={o.id}>
                    <td className="px-4 py-3 font-medium text-slate-800">{o.name}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {o.type === "party" ? "Owner" : "Company"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{o.shareClass ?? "—"}</td>
                    <td className="px-4 py-3 text-right text-slate-800">{fmtPct(o.percentage)}</td>
                    <td className="px-4 py-3 text-right">
                      <form action={deleteOwnership}>
                        <input type="hidden" name="ownershipId" value={o.id} />
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
          <AddOwnerForm companyId={id} options={ownerOptions} />
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-medium text-slate-800">Ultimate beneficial owners (UBO)</h2>
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
                    <td className="px-4 py-3 font-medium text-slate-800">{nameOf(o.type, o.id)}</td>
                    <td className="px-4 py-3 text-right text-slate-800">{fmtPct(o.percentage)}</td>
                  </tr>
                ))}
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
                    <td className="px-4 py-3 text-slate-600">{labelForEntityType(t.entityType)}</td>
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

      {holdings.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-lg font-medium text-slate-800">This company&apos;s holdings</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {holdings.map((h) => (
                  <tr key={h.id}>
                    <td className="px-4 py-3 font-medium text-slate-800">{h.name}</td>
                    <td className="px-4 py-3 text-right text-slate-800">{fmtPct(h.percentage)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
