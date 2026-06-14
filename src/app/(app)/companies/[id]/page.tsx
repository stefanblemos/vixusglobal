import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { AddOwnerForm } from "@/components/add-owner-form";
import { deleteOwnership } from "@/lib/actions/ownership";
import { labelForEntityType, labelForJurisdiction, labelForRelationship } from "@/lib/catalog";
import { computeEffectiveOwners, edgesFromOwnerships } from "@/lib/ownership/effective";

const fmtPct = (n: number) => `${n.toLocaleString("en-US", { maximumFractionDigits: 4 })}%`;

export default async function CompanyDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [company, parties, companies, ownerships] = await Promise.all([
    prisma.company.findUnique({ where: { id } }),
    prisma.party.findMany({ orderBy: { name: "asc" } }),
    prisma.company.findMany({ orderBy: { legalName: "asc" } }),
    prisma.ownership.findMany(),
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
        </div>
      </div>

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
