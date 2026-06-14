import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DateRangeFilter } from "@/components/date-range-filter";

const compact = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

const SPIKE = 2.5; // múltiplo da média mensal que marca um possível outlier

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; from?: string; to?: string }>;
}) {
  const { company, from: fromRaw, to } = await searchParams;

  // Empresas com GL (mesma fonte do razão).
  const glImports = await prisma.qboImport.findMany({
    where: { reportKind: "GENERAL_LEDGER" },
    orderBy: { createdAt: "desc" },
    include: { company: true },
  });

  if (!company) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Audit — account variations</h1>
          <p className="text-sm text-slate-500">
            Monthly totals per account to spot anomalies. Pick a company.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {glImports.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">Import a General Ledger first.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {glImports.map((imp) => (
                  <tr key={imp.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/audit?company=${imp.companyId}`}
                        className="font-medium text-[#1f3a5f] hover:underline"
                      >
                        {imp.company?.legalName ?? imp.sourceCompanyName}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  // Período padrão: 2025 em diante (2025 = comparação, 2026 = auditoria).
  const from = fromRaw ?? "2025-01-01";
  const comp = await prisma.company.findUnique({ where: { id: company } });

  const rows = await prisma.$queryRaw<{ account: string; ym: string; total: number }[]>`
    SELECT account, to_char(date, 'YYYY-MM') AS ym, SUM(amount)::float8 AS total
    FROM "LedgerTxn"
    WHERE "companyId" = ${company}
      ${from ? Prisma.sql`AND date >= ${new Date(`${from}T00:00:00Z`)}` : Prisma.empty}
      ${to ? Prisma.sql`AND date <= ${new Date(`${to}T23:59:59Z`)}` : Prisma.empty}
    GROUP BY account, ym
    ORDER BY account, ym
  `;

  const months = [...new Set(rows.map((r) => r.ym))].sort();
  const byAccount = new Map<string, Map<string, number>>();
  for (const r of rows) {
    (byAccount.get(r.account) ?? byAccount.set(r.account, new Map()).get(r.account)!).set(
      r.ym,
      r.total,
    );
  }

  // Ordena por atividade total (|soma|) e calcula outliers por conta.
  const accounts = [...byAccount.entries()]
    .map(([account, m]) => {
      const vals = months.map((ym) => m.get(ym) ?? 0);
      const nonzero = vals.filter((v) => v !== 0);
      const avgAbs = nonzero.length
        ? nonzero.reduce((s, v) => s + Math.abs(v), 0) / nonzero.length
        : 0;
      const flags = new Set(
        months.filter((ym) => {
          const v = m.get(ym) ?? 0;
          return avgAbs > 0 && Math.abs(v) > SPIKE * avgAbs && Math.abs(v) > 100;
        }),
      );
      const activity = vals.reduce((s, v) => s + Math.abs(v), 0);
      return { account, m, flags, activity };
    })
    .sort((a, b) => b.activity - a.activity)
    .slice(0, 60);

  const totalFlags = accounts.reduce((s, a) => s + a.flags.size, 0);

  return (
    <div className="space-y-5">
      <div>
        <Link href="/audit" className="text-sm text-slate-500 hover:text-slate-700">
          ← Audit
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">{comp?.legalName ?? "—"}</h1>
        <p className="text-sm text-slate-500">
          Monthly total per account · {months.length} months · {accounts.length} accounts ·{" "}
          <span className="text-amber-700">{totalFlags} possible anomalies</span> (a month &gt;{" "}
          {SPIKE}× the account average is highlighted).
        </p>
      </div>

      <DateRangeFilter
        hidden={{ company }}
        from={from}
        to={to}
        clearHref={`/audit?company=${company}`}
      />

      <div className="overflow-auto rounded-xl border border-slate-200 bg-white">
        <table className="text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-medium">
                Account
              </th>
              {months.map((ym) => (
                <th key={ym} className="px-3 py-2 text-right font-medium whitespace-nowrap">
                  {ym}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {accounts.map((a) => (
              <tr key={a.account} className="hover:bg-slate-50">
                <td className="sticky left-0 z-10 max-w-56 truncate bg-white px-3 py-1.5 text-slate-700">
                  {a.account}
                </td>
                {months.map((ym) => {
                  const v = a.m.get(ym);
                  const flagged = a.flags.has(ym);
                  return (
                    <td
                      key={ym}
                      className={`px-3 py-1.5 text-right whitespace-nowrap tabular-nums ${
                        flagged ? "bg-amber-100 font-medium text-amber-800" : "text-slate-600"
                      }`}
                    >
                      {v == null || v === 0 ? "" : compact(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
