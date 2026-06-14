import Link from "next/link";
import { prisma } from "@/lib/db";
import { ImportForm } from "@/components/import-form";

const REPORT_LABEL: Record<string, string> = {
  BALANCE_SHEET: "Balance Sheet",
  PROFIT_AND_LOSS: "Profit & Loss",
  UNKNOWN: "Unknown",
};

export default async function ImportPage() {
  const imports = await prisma.qboImport.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { company: true, _count: { select: { lines: true } } },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Import QBO report</h1>
        <p className="text-sm text-slate-500">
          Upload a QuickBooks Balance Sheet or Profit &amp; Loss CSV export.
        </p>
      </div>

      <ImportForm />

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-800">Recent imports</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {imports.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No imports yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Source name</th>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Report</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 text-right font-medium">Lines</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {imports.map((imp) => (
                  <tr key={imp.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/import/${imp.id}`}
                        className="font-medium text-[#1f3a5f] hover:underline"
                      >
                        {imp.sourceCompanyName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {imp.company?.legalName ?? <span className="text-amber-600">Not linked</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{REPORT_LABEL[imp.reportKind]}</td>
                    <td className="px-4 py-3 text-slate-600">{imp.periodLabel}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{imp._count.lines}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
