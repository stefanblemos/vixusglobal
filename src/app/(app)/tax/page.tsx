import Link from "next/link";
import { prisma } from "@/lib/db";
import { IrUpload } from "@/components/ir-upload";
import { applyTaxReturnClassification } from "@/lib/actions/ir";
import { labelForTaxTreatment, labelForJurisdiction } from "@/lib/catalog";
import { ALL_ENTITY_TYPE_VALUES, ALL_TAX_TREATMENT_VALUES } from "@/lib/catalog";

type Owner = { name: string; ownershipPct: number | null; role: string | null };

const CONF: Record<string, string> = {
  high: "bg-green-50 text-green-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-red-50 text-red-700",
};

export default async function TaxPage() {
  const returns = await prisma.taxReturn.findMany({
    orderBy: { createdAt: "desc" },
    include: { company: true },
    take: 25,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Tax — IR analysis</h1>
        <p className="text-sm text-slate-500">
          Upload a tax return and Claude extracts the partners and the tax treatment, then you can
          apply it to the company&apos;s tax classification.
        </p>
      </div>

      <IrUpload />

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-800">Analyzed returns</h2>
        {returns.length === 0 ? (
          <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
            No tax returns analyzed yet.
          </div>
        ) : (
          <div className="space-y-4">
            {returns.map((r) => {
              const owners = (r.owners as Owner[] | null) ?? [];
              const canApply =
                r.companyId != null &&
                r.year != null &&
                ALL_ENTITY_TYPE_VALUES.includes(r.entityType ?? "") &&
                ALL_TAX_TREATMENT_VALUES.includes(r.taxTreatment ?? "");
              return (
                <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">
                          {r.company ? (
                            <Link
                              href={`/companies/${r.companyId}`}
                              className="text-[#1f3a5f] hover:underline"
                            >
                              {r.company.legalName}
                            </Link>
                          ) : (
                            (r.matchedName ?? "Unknown company")
                          )}
                        </span>
                        {!r.company && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                            no match in registry
                          </span>
                        )}
                        {r.confidence && (
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs ${CONF[r.confidence] ?? "bg-slate-100 text-slate-500"}`}
                          >
                            {r.confidence} confidence
                          </span>
                        )}
                        {r.status === "APPLIED" && (
                          <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
                            applied ✓
                          </span>
                        )}
                      </div>
                      <p className="mt-1 text-sm text-slate-500">
                        {r.fileName} · {r.year ?? "—"} ·{" "}
                        {r.jurisdiction ? labelForJurisdiction(r.jurisdiction) : "—"}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-slate-500">{r.taxForm ?? "—"}</div>
                      <div className="font-medium text-slate-800">
                        {r.taxTreatment ? labelForTaxTreatment(r.taxTreatment) : "—"}
                      </div>
                    </div>
                  </div>

                  {r.summary && <p className="mt-3 text-sm text-slate-600">{r.summary}</p>}

                  <div className="mt-4">
                    <div className="mb-1 text-xs font-medium text-slate-500">
                      Partners / shareholders ({owners.length})
                    </div>
                    {owners.length === 0 ? (
                      <p className="text-sm text-slate-400">None found in the document.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-slate-100">
                          {owners.map((o, i) => (
                            <tr key={i}>
                              <td className="py-1.5 text-slate-700">{o.name}</td>
                              <td className="py-1.5 text-slate-500">{o.role ?? "—"}</td>
                              <td className="py-1.5 text-right tabular-nums text-slate-800">
                                {o.ownershipPct != null ? `${o.ownershipPct}%` : "—"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {canApply && r.status !== "APPLIED" && (
                    <form
                      action={applyTaxReturnClassification}
                      className="mt-4 border-t border-slate-100 pt-3"
                    >
                      <input type="hidden" name="id" value={r.id} />
                      <button className="rounded-lg border border-[#1f3a5f] px-3 py-1.5 text-xs font-medium text-[#1f3a5f] hover:bg-[#1f3a5f]/[0.04]">
                        Apply {r.year} tax classification to {r.company?.legalName}
                      </button>
                    </form>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
