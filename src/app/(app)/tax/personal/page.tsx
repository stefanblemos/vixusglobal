import Link from "next/link";
import { prisma } from "@/lib/db";
import { PersonalUpload } from "@/components/personal-upload";
import { deletePersonalReturn } from "@/lib/actions/personal";
import { crossCheckPersonalReturn } from "@/lib/personal/reconcile";

export const dynamic = "force-dynamic";

const usd = (v: unknown) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(Number(v));

const num = (v: unknown) => (v == null ? null : Number(v));

export default async function PersonalReturnsPage() {
  const [returns, entityReturns, companies] = await Promise.all([
    prisma.personalReturn.findMany({ orderBy: [{ year: "desc" }, { createdAt: "desc" }] }),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null } },
      select: { companyId: true, year: true, owners: true },
    }),
    prisma.company.findMany({ select: { id: true, legalName: true } }),
  ]);
  const companyNameById = new Map(companies.map((c) => [c.id, c.legalName]));
  const entRows = entityReturns.map((r) => ({
    companyId: r.companyId,
    year: r.year,
    owners: r.owners as { name: string; allocatedIncome: number | null }[] | null,
  }));

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Link href="/tax" className="hover:text-slate-600">
            Tax
          </Link>
          <span>/</span>
          <span>Personal returns (1040)</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Personal returns — 1040</h1>
        <p className="text-sm text-slate-500">
          Closes the loop from entity to individual: each K-1 a person&rsquo;s LLCs allocated to them
          should land on their 1040&rsquo;s Schedule E. Upload the return or the IRS transcript and
          the platform checks it.
        </p>
      </div>

      <PersonalUpload />

      {returns.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No personal returns yet.
        </div>
      ) : (
        <div className="space-y-4">
          {returns.map((r) => {
            const cc = crossCheckPersonalReturn(
              {
                matchedName: r.matchedName,
                spouseName: r.spouseName,
                year: r.year,
                partnershipIncome: num(r.partnershipIncome),
                partnershipLoss: num(r.partnershipLoss),
              },
              entRows,
              companyNameById,
            );
            return (
              <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-800">
                        {r.matchedName ?? "Unknown taxpayer"}
                        {r.spouseName ? ` & ${r.spouseName}` : ""}
                      </span>
                      {r.partyId ? (
                        <Link
                          href="/parties"
                          className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500 hover:bg-slate-200"
                        >
                          linked owner
                        </Link>
                      ) : (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
                          no match in owners
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {r.fileName} · {r.year ?? "—"} · {r.form ?? "1040"}
                      {r.filingStatus ? ` · ${r.filingStatus}` : ""}
                      {r.ssnLast4 ? ` · SSN •••-••-${r.ssnLast4}` : ""}
                      {r.spouseSsnLast4 ? ` / •••-••-${r.spouseSsnLast4}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-3 text-sm">
                    <a
                      href={`/api/personal-returns/${r.id}/pdf`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-[#1f3a5f] hover:underline"
                    >
                      View PDF
                    </a>
                    <form action={deletePersonalReturn}>
                      <input type="hidden" name="id" value={r.id} />
                      <button className="text-slate-400 hover:text-red-600">Delete</button>
                    </form>
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Kpi label="Wages" value={usd(r.wages)} />
                  <Kpi label="Sch E — partnership" value={usd(num(r.partnershipIncome))} />
                  <Kpi label="Total income" value={usd(r.totalIncome)} />
                  <Kpi label="Total tax" value={usd(r.totalTax)} />
                </div>

                {/* Cruzamento entidade → pessoa física */}
                <div className="mt-4">
                  <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-700">
                      K-1s expected on this return ({r.year ?? "—"})
                    </span>
                    <CrossBadge status={cc.status} gap={cc.gap} />
                  </div>
                  {cc.contributions.length === 0 ? (
                    <p className="text-sm text-slate-400">
                      No registered LLC allocated income to {cc.names.join(" or ") || "this person"}{" "}
                      in {r.year ?? "this year"} — nothing to cross-check yet.
                    </p>
                  ) : (
                    <div className="overflow-hidden rounded-xl border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="bg-slate-50 text-left text-slate-500">
                          <tr>
                            <th className="px-4 py-2 font-medium">LLC (issuer)</th>
                            <th className="px-4 py-2 font-medium">Partner name on its K-1</th>
                            <th className="px-4 py-2 text-right font-medium">Allocated</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {cc.contributions.map((c, i) => (
                            <tr key={i}>
                              <td className="px-4 py-2">
                                <Link
                                  href={`/companies/${c.entityId}/year/${c.year}`}
                                  className="text-[#1f3a5f] hover:underline"
                                >
                                  {c.entityName}
                                </Link>
                              </td>
                              <td className="px-4 py-2 text-slate-600">{c.ownerName}</td>
                              <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                                {usd(c.allocated)}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                        <tfoot className="border-t-2 border-slate-200 bg-slate-50/60">
                          <tr>
                            <td className="px-4 py-2 font-medium text-slate-700" colSpan={2}>
                              Expected on Schedule E (sum of K-1s)
                            </td>
                            <td className="px-4 py-2 text-right font-semibold tabular-nums text-slate-900">
                              {usd(cc.expectedTotal)}
                            </td>
                          </tr>
                          <tr>
                            <td className="px-4 py-2 text-slate-700" colSpan={2}>
                              Reported on the 1040 (Schedule E partnership, net)
                            </td>
                            <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                              {cc.reportedNet == null ? "—" : usd(cc.reportedNet)}
                            </td>
                          </tr>
                          {cc.gap != null && Math.abs(cc.gap) > Math.max(1, Math.abs(cc.expectedTotal) * 0.02) && (
                            <tr className="bg-red-50/50 font-medium text-red-700">
                              <td className="px-4 py-2" colSpan={2}>
                                Gap — review (reported − expected)
                              </td>
                              <td className="px-4 py-2 text-right tabular-nums">{usd(cc.gap)}</td>
                            </tr>
                          )}
                        </tfoot>
                      </table>
                    </div>
                  )}
                </div>

                {r.summary && <p className="mt-3 text-sm text-slate-500">{r.summary}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50/40 p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-0.5 font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function CrossBadge({ status, gap }: { status: string; gap: number | null }) {
  if (status === "match")
    return (
      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
        matches the K-1s ✓
      </span>
    );
  if (status === "diff")
    return (
      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
        differs by {gap != null ? usd(gap) : "—"}
      </span>
    );
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
      not enough data
    </span>
  );
}
