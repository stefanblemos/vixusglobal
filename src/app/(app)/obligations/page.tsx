import Link from "next/link";
import { buildObligationCalendar } from "@/lib/obligations/calendar";
import { ObligationStatusCell } from "@/components/obligation-status-cell";
import { labelForEntityType } from "@/lib/catalog";
import type { Obligation } from "@/lib/obligations/rules";

export const dynamic = "force-dynamic";

const AUTH_CLS: Record<string, string> = {
  IRS: "bg-blue-50 text-blue-700",
  "FL DOR": "bg-orange-50 text-orange-700",
  "Sunbiz (FL DOS)": "bg-purple-50 text-purple-700",
  County: "bg-teal-50 text-teal-700",
  FinCEN: "bg-slate-100 text-slate-600",
};

const monthLabel = (ym: string) =>
  new Date(`${ym}-01T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export default async function ObligationsPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const year = yearParam && /^\d{4}$/.test(yearParam) ? Number(yearParam) : currentYear;

  const cal = await buildObligationCalendar(year);

  const byMonth = new Map<string, typeof cal.instances>();
  for (const i of cal.instances) {
    const k = i.dueDate.slice(0, 7);
    (byMonth.get(k) ?? byMonth.set(k, []).get(k)!).push(i);
  }
  const months = [...byMonth.keys()].sort();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Obligations calendar</h1>
        <p className="text-sm text-slate-500">
          Filings and deadlines by due date — monthly sales tax, quarterly payroll/estimates, and
          annual returns. Click a status to mark it filed. A checklist to confirm with the
          accountant, not legal advice.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Year:</span>
        {cal.years.map((y) => (
          <Link
            key={y}
            href={`/obligations?year=${y}`}
            className={`rounded-full px-3 py-1 ${
              y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {y}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Overdue" value={cal.counts.overdue} cls="text-rose-600" />
        <Stat label="Pending" value={cal.counts.pending} cls="text-amber-600" />
        <Stat label="Filed" value={cal.counts.filed} cls="text-emerald-600" />
      </div>

      {months.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No dated obligations for {year}.
        </div>
      ) : (
        months.map((m) => (
          <section key={m} className="space-y-2">
            <h2 className="text-sm font-medium text-slate-500">{monthLabel(m)}</h2>
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Due</th>
                    <th className="px-4 py-2 font-medium">Company</th>
                    <th className="px-4 py-2 font-medium">Obligation</th>
                    <th className="px-4 py-2 font-medium">Period</th>
                    <th className="px-4 py-2 font-medium">Authority</th>
                    <th className="px-4 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {byMonth.get(m)!.map((i) => (
                    <tr
                      key={`${i.companyId}-${i.key}-${i.periodKey}`}
                      className={i.overdue ? "bg-rose-50/40" : ""}
                    >
                      <td className="whitespace-nowrap px-4 py-2 text-slate-600">
                        {dayLabel(i.dueDate)}
                      </td>
                      <td className="px-4 py-2 text-slate-700">{i.companyName}</td>
                      <td className="px-4 py-2 text-slate-700">{i.name}</td>
                      <td className="px-4 py-2 text-xs text-slate-500">{i.periodLabel}</td>
                      <td className="px-4 py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${AUTH_CLS[i.authority] ?? "bg-slate-100 text-slate-600"}`}
                        >
                          {i.authority}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right">
                        <ObligationStatusCell
                          companyId={i.companyId}
                          oblKey={i.key}
                          periodKey={i.periodKey}
                          status={i.status}
                          overdue={i.overdue}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-slate-700">
          Reference — all obligations by company ({cal.reference.length})
        </summary>
        <div className="space-y-5 border-t border-slate-100 px-4 py-4">
          {cal.reference.map((r) => (
            <div key={r.companyId} className="space-y-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Link
                  href={`/companies/${r.companyId}`}
                  className="font-medium text-[#1f3a5f] hover:underline"
                >
                  {r.companyName}
                </Link>
                {r.treatment && (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {r.treatment.replace("_", "-")}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.obligations.map((o: Obligation) => (
                  <span
                    key={o.key}
                    title={`${o.frequency} · ${o.due}${o.note ? ` — ${o.note}` : ""}`}
                    className={`rounded-md px-2 py-0.5 text-xs ${o.applies === "review" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}
                  >
                    {o.name}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </details>

      <p className="text-xs text-slate-400">
        Dates are the standard federal/Florida deadlines (e.g. sales tax due the 20th, FL annual
        report May 1, 1065/1120-S Mar 15, 1120 Apr 15). Confirm extensions and the exact filing
        frequency with the accountant. <span className="text-amber-600">Amber = depends on the facts.</span>
      </p>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
