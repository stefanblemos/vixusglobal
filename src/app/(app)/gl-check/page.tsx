import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { buildGlCrosscheck, type CrosscheckReport } from "@/lib/qbo/gl-crosscheck";

export const dynamic = "force-dynamic";

export default async function GlCheckPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; year?: string }>;
}) {
  const { company, year: yearParam } = await searchParams;
  const selectedYear = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : null;

  const glImports = await prisma.qboImport.findMany({
    where: { reportKind: "GENERAL_LEDGER" },
    orderBy: { createdAt: "desc" },
    include: { company: true },
  });

  if (!company) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">GL check — ledger vs reports</h1>
          <p className="text-sm text-slate-500">
            Cross-checks each account: the General Ledger against the Balance Sheet (ending balance)
            and the Profit &amp; Loss (period movement). Pick a company with a GL imported.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {glImports.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No General Ledger imported yet. Upload one in Documents.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {glImports.map((imp) => {
                  const y = imp.periodLabel.match(/20\d\d/)?.[0];
                  return (
                    <tr key={imp.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/gl-check?company=${imp.companyId}${y ? `&year=${y}` : ""}`}
                          className="font-medium text-[#1f3a5f] hover:underline"
                        >
                          {imp.company?.legalName ?? imp.sourceCompanyName}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{imp.periodLabel}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  const x = await buildGlCrosscheck(company, selectedYear);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/gl-check" className="text-sm text-slate-500 hover:text-slate-700">
          ← GL check
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">{x.companyName}</h1>
        <p className="text-sm text-slate-500">
          {x.hasGl ? `General Ledger · ${x.glPeriod}` : "No General Ledger imported."} Compares each
          account by magnitude (sign conventions between reports and the ledger differ); ✓ within
          1% or $1.
        </p>
        {x.availableYears.length > 1 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-sm">
            <span className="mr-1 text-slate-400">Ano:</span>
            {x.availableYears.map((y) => (
              <Link
                key={y}
                href={`/gl-check?company=${company}&year=${y}`}
                className={`rounded-full px-3 py-1 ${
                  y === x.year
                    ? "bg-[#1f3a5f] text-white"
                    : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                }`}
              >
                {y}
              </Link>
            ))}
          </div>
        )}
      </div>

      {!x.hasGl ? null : (
        <>
          <ReportBlock
            title="Profit & Loss vs GL (period movement)"
            report={x.pnl}
            missingMsg="No Profit & Loss on file for this year — upload it in Documents."
          />
          <ReportBlock
            title="Balance Sheet vs GL (ending balance)"
            report={x.bs}
            missingMsg="No Balance Sheet on file for this year — upload it in Documents."
          />
        </>
      )}
    </div>
  );
}

function ReportBlock({
  title,
  report,
  missingMsg,
}: {
  title: string;
  report: CrosscheckReport | null;
  missingMsg: string;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-medium text-slate-800">{title}</h2>
        {report && (
          <div className="flex gap-2 text-xs">
            <span className="rounded-full bg-green-50 px-2.5 py-0.5 text-green-700">
              {report.matched} match
            </span>
            <span
              className={`rounded-full px-2.5 py-0.5 ${
                report.mismatched > 0 ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-500"
              }`}
            >
              {report.mismatched} differ
            </span>
            {report.unmatchedReport.length > 0 && (
              <span className="rounded-full bg-amber-50 px-2.5 py-0.5 text-amber-700">
                {report.unmatchedReport.length} unmatched
              </span>
            )}
          </div>
        )}
      </div>

      {!report ? (
        <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
          {missingMsg}
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Account</th>
                <th className="px-4 py-2 text-right font-medium">Reported</th>
                <th className="px-4 py-2 text-right font-medium">GL</th>
                <th className="px-4 py-2 text-right font-medium">Difference</th>
                <th className="px-4 py-2 text-center font-medium"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {report.rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-3 text-sm text-slate-400">
                    No matching accounts between the report and the ledger.
                  </td>
                </tr>
              ) : (
                report.rows.map((r) => (
                  <tr key={r.account} className={r.ok ? "" : "bg-rose-50/40"}>
                    <td className="px-4 py-1.5 text-slate-700">
                      {r.reportLabel}
                      {r.reportLabel !== r.account && (
                        <span className="ml-1 text-xs text-slate-400">· GL: {r.account}</span>
                      )}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-700">
                      {formatMoney(r.reported, "USD")}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums text-slate-700">
                      {formatMoney(r.gl, "USD")}
                    </td>
                    <td
                      className={`px-4 py-1.5 text-right tabular-nums ${
                        r.ok ? "text-slate-400" : "font-medium text-rose-600"
                      }`}
                    >
                      {formatMoney(r.diff, "USD")}
                    </td>
                    <td className="px-4 py-1.5 text-center">
                      {r.ok ? (
                        <span className="text-green-600">✓</span>
                      ) : (
                        <span className="text-rose-500">✗</span>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {report.unmatchedReport.length > 0 && (
            <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">
              <span className="text-amber-600">Unmatched report accounts:</span>{" "}
              {report.unmatchedReport.join(" · ")}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
