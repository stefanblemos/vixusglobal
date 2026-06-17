import Link from "next/link";
import { prisma } from "@/lib/db";
import { labelForEntityType, labelForJurisdiction, labelForRelationship } from "@/lib/catalog";

export const dynamic = "force-dynamic";

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ closed?: string }>;
}) {
  const { closed } = await searchParams;
  const showClosed = closed === "1";

  const companies = await prisma.company.findMany({
    orderBy: { legalName: "asc" },
    include: { taxReturns: { where: { isFinalReturn: true }, select: { year: true } } },
  });

  const currentYear = new Date().getFullYear();
  const enriched = companies.map((c) => {
    const finalYears = c.taxReturns.map((t) => t.year).filter((y): y is number => y != null);
    const finalReturnYear = finalYears.length > 0 ? Math.max(...finalYears) : null;
    const isClosed = finalReturnYear != null || c.status === "INACTIVE";
    // Sai da lista quando o ano fiscal do encerramento já virou (ou inativa sem IR final).
    const pastClosure = isClosed && (finalReturnYear == null || currentYear > finalReturnYear);
    return { ...c, finalReturnYear, isClosed, pastClosure };
  });

  const visible = showClosed ? enriched : enriched.filter((c) => !c.pastClosure);
  const hiddenCount = enriched.filter((c) => c.pastClosure).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Companies</h1>
          <p className="text-sm text-slate-500">
            {visible.length} {showClosed ? "total" : "active"}
            {!showClosed && hiddenCount > 0 ? ` · ${hiddenCount} closed hidden` : ""}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {(hiddenCount > 0 || showClosed) && (
            <Link
              href={showClosed ? "/companies" : "/companies?closed=1"}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              {showClosed ? "Hide closed" : `Show closed (${hiddenCount})`}
            </Link>
          )}
          <Link
            href="/companies/new"
            className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
          >
            + New company
          </Link>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          {companies.length === 0 ? "No companies registered yet." : "No active companies."}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Legal name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Jurisdiction</th>
                <th className="px-4 py-3 font-medium">Relationship</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visible.map((c) => (
                <tr key={c.id} className={`hover:bg-slate-50 ${c.isClosed ? "bg-rose-50/30" : ""}`}>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/companies/${c.id}`}
                        className="font-medium text-[#1f3a5f] hover:underline"
                      >
                        {c.legalName}
                      </Link>
                      {c.finalReturnYear && (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700">
                          final return {c.finalReturnYear}
                        </span>
                      )}
                    </div>
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
                  <td className="px-4 py-3">
                    {c.isClosed ? (
                      <span className="rounded-full bg-rose-50 px-2 py-0.5 text-xs text-rose-700">
                        Closed
                      </span>
                    ) : (
                      <span className="text-xs text-emerald-600">Active</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
