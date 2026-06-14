import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { DateRangeFilter } from "@/components/date-range-filter";

const isoDate = (d: Date) => d.toISOString().slice(0, 10);
const LIMIT = 200;

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; from?: string; to?: string; account?: string }>;
}) {
  const { company, from, to, account } = await searchParams;

  const glImports = await prisma.qboImport.findMany({
    where: { reportKind: "GENERAL_LEDGER" },
    orderBy: { createdAt: "desc" },
    include: { company: true, _count: { select: { ledgerTxns: true } } },
  });

  if (!company) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Ledger</h1>
          <p className="text-sm text-slate-500">
            Transaction-level General Ledger imported from QBO. Pick a company.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {glImports.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No General Ledger imported yet. Run the GL import.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 text-right font-medium">Transactions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {glImports.map((imp) => (
                  <tr key={imp.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/ledger?company=${imp.companyId}`}
                        className="font-medium text-[#1f3a5f] hover:underline"
                      >
                        {imp.company?.legalName ?? imp.sourceCompanyName}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{imp.periodLabel}</td>
                    <td className="px-4 py-3 text-right text-slate-600">{imp._count.ledgerTxns}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    );
  }

  const dateFilter =
    from || to
      ? {
          date: {
            ...(from ? { gte: new Date(`${from}T00:00:00Z`) } : {}),
            ...(to ? { lte: new Date(`${to}T23:59:59Z`) } : {}),
          },
        }
      : {};
  const txnWhere = { companyId: company, ...dateFilter, ...(account ? { account } : {}) };

  const [comp, total, txns, accountCount, vendorCount] = await Promise.all([
    prisma.company.findUnique({ where: { id: company } }),
    prisma.ledgerTxn.count({ where: txnWhere }),
    prisma.ledgerTxn.findMany({
      where: txnWhere,
      orderBy: { date: "desc" },
      take: LIMIT,
      include: { vendor: true },
    }),
    prisma.ledgerTxn.findMany({
      where: txnWhere,
      distinct: ["account"],
      select: { account: true },
    }),
    prisma.ledgerTxn.findMany({
      where: { ...txnWhere, vendorId: { not: null } },
      distinct: ["vendorId"],
      select: { vendorId: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/ledger" className="text-sm text-slate-500 hover:text-slate-700">
          ← Ledger
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">{comp?.legalName ?? "—"}</h1>
        <p className="text-sm text-slate-500">
          {total.toLocaleString("en-US")} transactions · {accountCount.length} accounts ·{" "}
          {vendorCount.length} vendors · showing latest {Math.min(LIMIT, total)}
        </p>
        {account && (
          <div className="mt-2 inline-flex items-center gap-2 rounded-full bg-[#1f3a5f]/[0.06] px-3 py-1 text-sm text-[#1f3a5f]">
            Account: {account}
            <a href={`/ledger?company=${company}`} className="text-slate-400 hover:text-slate-700">
              ✕
            </a>
          </div>
        )}
      </div>

      <DateRangeFilter
        hidden={{ company, account }}
        from={from}
        to={to}
        clearHref={`/ledger?company=${company}${account ? `&account=${encodeURIComponent(account)}` : ""}`}
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Split</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {txns.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50">
                <td className="px-3 py-1.5 whitespace-nowrap text-slate-600">{isoDate(t.date)}</td>
                <td className="px-3 py-1.5 text-slate-600">{t.type}</td>
                <td className="px-3 py-1.5 text-slate-700">{t.account}</td>
                <td className="px-3 py-1.5 text-slate-700">
                  {t.vendor?.name ?? t.rawName ?? "—"}
                  {(t.vendor?.matchedCompanyId || t.vendor?.matchedPartyId) && (
                    <span className="ml-1 text-xs text-green-700">●</span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-slate-500">{t.split ?? "—"}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">
                  {formatMoney(t.amount, t.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
