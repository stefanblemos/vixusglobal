import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { build1099Worklist } from "@/lib/tax/form1099";

export const dynamic = "force-dynamic";

export default async function Form1099Page({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; year?: string }>;
}) {
  const { company, year: yearParam } = await searchParams;

  const companies = await prisma.company.findMany({
    where: { ledgerTxns: { some: {} } },
    select: { id: true, legalName: true },
    orderBy: { legalName: "asc" },
  });

  if (!company) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">1099-NEC worklist</h1>
          <p className="text-sm text-slate-500">
            Vendors paid $600+ for services in a calendar year, from the General Ledger — a control
            list to confirm in QBO. Cash basis; credit-card payments go on the processor&rsquo;s
            1099-K, not here.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {companies.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">
              No ledger imported yet. Upload a General Ledger in Documents.
            </p>
          ) : (
            <table className="w-full text-sm">
              <tbody className="divide-y divide-slate-100">
                {companies.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/1099?company=${c.id}`}
                        className="font-medium text-[#1f3a5f] hover:underline"
                      >
                        {c.legalName}
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

  const wantedYear = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : undefined;
  const w = await build1099Worklist(company, wantedYear);
  const totalNec = w.payees.reduce((s, p) => s + p.total, 0);

  return (
    <div className="space-y-6">
      <div>
        <Link href="/1099" className="text-sm text-slate-500 hover:text-slate-700">
          ← 1099 worklist
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">{w.companyName}</h1>
        <p className="text-sm text-slate-500">
          Vendors paid $600+ in {w.year}. Confirm each in QBO before issuing — services only,
          non-corporate payees, and collect a W-9.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Year:</span>
        {w.years.map((y) => (
          <Link
            key={y}
            href={`/1099?company=${company}&year=${y}`}
            className={`rounded-full px-3 py-1 ${
              y === w.year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {y}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Payees ≥ $600`} value={String(w.payees.length)} />
        <Stat label="Total (NEC candidates)" value={formatMoney(totalNec, "USD")} />
        <Stat label="Below $600" value={`${w.belowCount}`} sub={formatMoney(w.belowTotal, "USD")} />
        <Stat
          label="Paid by card (1099-K)"
          value={formatMoney(w.cardPaidTotal, "USD")}
          sub={`${w.cardPaidCount} payments — excluded`}
        />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Payee</th>
              <th className="px-4 py-2 text-right font-medium">Paid in {w.year}</th>
              <th className="px-4 py-2 text-right font-medium">Payments</th>
              <th className="px-4 py-2 font-medium">Categories</th>
              <th className="px-4 py-2 font-medium">Flags</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {w.payees.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-4 text-sm text-slate-400">
                  No vendor reached $600 in {w.year}.
                </td>
              </tr>
            ) : (
              w.payees.map((p) => (
                <tr key={p.key} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-medium text-slate-700">{p.name}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-800">
                    {formatMoney(p.total, "USD")}
                  </td>
                  <td className="px-4 py-2 text-right tabular-nums text-slate-500">{p.count}</td>
                  <td className="max-w-xs px-4 py-2 text-xs text-slate-500">
                    {p.categories.join(" · ") || "—"}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {p.flags.map((f) => (
                        <span
                          key={f}
                          className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700"
                        >
                          {f}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {w.excludedIntercompany.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-white">
          <summary className="cursor-pointer px-4 py-3 text-sm text-slate-600">
            Excluded — group / intercompany payees ({w.excludedIntercompany.length})
          </summary>
          <div className="border-t border-slate-100 px-4 py-2 text-sm text-slate-500">
            {w.excludedIntercompany.map((e) => (
              <div key={e.name} className="flex justify-between py-0.5">
                <span>{e.name}</span>
                <span className="tabular-nums">{formatMoney(e.total, "USD")}</span>
              </div>
            ))}
          </div>
        </details>
      )}

      <p className="text-xs text-slate-400">
        Based on cash payments (Expense / Check / Bill Payment by check) per payee. A control aid,
        not tax advice — corporations are generally exempt, attorneys are an exception, and
        merchandise/freight/taxes aren&rsquo;t 1099-NEC. Verify in QBO.
      </p>
    </div>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-800">{value}</div>
      {sub && <div className="text-xs text-slate-400">{sub}</div>}
    </div>
  );
}
