import Link from "next/link";
import { prisma } from "@/lib/db";
import { labelForEntityType, labelForJurisdiction, labelForRelationship } from "@/lib/catalog";

export default async function CompaniesPage() {
  const companies = await prisma.company.findMany({ orderBy: { legalName: "asc" } });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Empresas</h1>
          <p className="text-sm text-slate-500">{companies.length} cadastrada(s)</p>
        </div>
        <Link
          href="/companies/new"
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
        >
          + Nova empresa
        </Link>
      </div>

      {companies.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          Nenhuma empresa cadastrada ainda.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Razão social</th>
                <th className="px-4 py-3 font-medium">Tipo</th>
                <th className="px-4 py-3 font-medium">Jurisdição</th>
                <th className="px-4 py-3 font-medium">Relação</th>
                <th className="px-4 py-3 font-medium">Moeda</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {companies.map((c) => (
                <tr key={c.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{c.legalName}</div>
                    {c.tradeName && <div className="text-xs text-slate-400">{c.tradeName}</div>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{labelForEntityType(c.entityType)}</td>
                  <td className="px-4 py-3 text-slate-600">
                    {labelForJurisdiction(c.jurisdiction)}
                    {c.state ? ` · ${c.state}` : ""}
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    {labelForRelationship(c.relationship)}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{c.baseCurrency}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
