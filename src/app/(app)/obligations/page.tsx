import Link from "next/link";
import { prisma } from "@/lib/db";
import { obligationsFor, type Obligation } from "@/lib/obligations/rules";
import { labelForEntityType } from "@/lib/catalog";

export const dynamic = "force-dynamic";

const AUTH_CLS: Record<string, string> = {
  IRS: "bg-blue-50 text-blue-700",
  "FL DOR": "bg-orange-50 text-orange-700",
  "Sunbiz (FL DOS)": "bg-purple-50 text-purple-700",
  County: "bg-teal-50 text-teal-700",
  FinCEN: "bg-slate-100 text-slate-600",
};

export default async function ObligationsPage() {
  const [companies, returns, ownerships, parties] = await Promise.all([
    prisma.company.findMany({
      where: { status: "ACTIVE", monitored: true },
      select: {
        id: true,
        legalName: true,
        jurisdiction: true,
        state: true,
        entityType: true,
        relationship: true,
        collectsSalesTax: true,
        hasEmployees: true,
      },
      orderBy: [{ relationship: "asc" }, { legalName: "asc" }],
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

  // Tributação mais recente por empresa.
  const treatmentByCompany = new Map<string, string>();
  for (const r of returns) {
    if (r.companyId && !treatmentByCompany.has(r.companyId)) {
      treatmentByCompany.set(r.companyId, r.taxTreatment ?? "");
    }
  }
  // Sócios estrangeiros (party com jurisdição != US, por participação direta).
  const foreignPartyIds = new Set(
    parties.filter((p) => p.taxJurisdiction && p.taxJurisdiction !== "US").map((p) => p.id),
  );
  const foreignByCompany = new Set<string>();
  for (const o of ownerships) {
    if (o.ownedCompanyId && o.ownerPartyId && foreignPartyIds.has(o.ownerPartyId)) {
      foreignByCompany.add(o.ownedCompanyId);
    }
  }

  const cards = companies.map((c) => ({
    company: c,
    treatment: treatmentByCompany.get(c.id) ?? null,
    obligations: obligationsFor({
      jurisdiction: c.jurisdiction,
      state: c.state,
      taxTreatment: treatmentByCompany.get(c.id) ?? null,
      collectsSalesTax: c.collectsSalesTax,
      hasEmployees: c.hasEmployees,
      hasForeignPartners: foreignByCompany.has(c.id),
    }),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Obligations</h1>
        <p className="text-sm text-slate-500">
          Filings and deadlines each company owes — federal, Florida DOR, Sunbiz annual report,
          sales tax (resellers), and more. A checklist to confirm with the accountant, not legal
          advice. <span className="text-amber-600">Amber = applies depending on the facts.</span>
        </p>
      </div>

      {cards.map(({ company, treatment, obligations }) => (
        <section key={company.id} className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/companies/${company.id}`}
              className="text-lg font-medium text-[#1f3a5f] hover:underline"
            >
              {company.legalName}
            </Link>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              {labelForEntityType(company.entityType)}
              {treatment ? ` · ${treatment.replace("_", "-")}` : ""}
              {company.state ? ` · ${company.state}` : ""}
            </span>
            {company.relationship === "MANAGED_ONLY" && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                managed
              </span>
            )}
            {company.collectsSalesTax && (
              <span className="rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700">
                reseller — sales tax
              </span>
            )}
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Obligation</th>
                  <th className="px-4 py-2 font-medium">Authority</th>
                  <th className="px-4 py-2 font-medium">Frequency</th>
                  <th className="px-4 py-2 font-medium">Due</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {obligations.map((o: Obligation) => (
                  <tr key={o.key} className={o.applies === "review" ? "bg-amber-50/30" : ""}>
                    <td className="px-4 py-2 text-slate-700">
                      {o.name}
                      {o.note && <div className="text-xs text-slate-400">{o.note}</div>}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${AUTH_CLS[o.authority] ?? "bg-slate-100 text-slate-600"}`}
                      >
                        {o.authority}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-slate-500">{o.frequency}</td>
                    <td className="px-4 py-2 text-slate-600">
                      {o.due}
                      {o.applies === "review" && (
                        <span className="ml-2 text-xs text-amber-600">confirm</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
