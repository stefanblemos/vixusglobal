import Link from "next/link";
import { prisma } from "@/lib/db";
import { labelForJurisdiction, labelForPartyKind } from "@/lib/catalog";

export default async function PartiesPage() {
  const parties = await prisma.party.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { personalReturns: true, ownerStakes: true } } },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Owners</h1>
          <p className="text-sm text-slate-500">{parties.length} registered</p>
        </div>
        <Link
          href="/parties/new"
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
        >
          + New owner
        </Link>
      </div>

      {parties.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          No owners registered yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Tax jurisdiction</th>
                <th className="px-4 py-3 font-medium">Returns</th>
                <th className="px-4 py-3 font-medium">Holdings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parties.map((p) => {
                const isPerson = p.kind === "PERSON";
                const NameCell = isPerson ? (
                  <Link
                    href={`/parties/${p.id}`}
                    className="font-medium text-[#1f3a5f] hover:underline"
                  >
                    {p.name}
                  </Link>
                ) : (
                  <span className="font-medium text-slate-800">{p.name}</span>
                );
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">{NameCell}</td>
                    <td className="px-4 py-3 text-slate-600">{labelForPartyKind(p.kind)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {labelForJurisdiction(p.taxJurisdiction)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {p._count.personalReturns > 0 ? `${p._count.personalReturns} 1040s` : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {p._count.ownerStakes > 0 ? `${p._count.ownerStakes}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
