import Link from "next/link";
import { prisma } from "@/lib/db";
import { IrUpload } from "@/components/ir-upload";
import {
  applyTaxReturnClassification,
  applyTaxReturnOwnership,
  deleteTaxReturn,
} from "@/lib/actions/ir";
import {
  labelForTaxTreatment,
  labelForJurisdiction,
  ALL_ENTITY_TYPE_VALUES,
  ALL_TAX_TREATMENT_VALUES,
} from "@/lib/catalog";
import { entityNames, ownerNameMatches } from "@/lib/ownership/reconcile";

type Owner = {
  name: string;
  taxIdLast4: string | null;
  ownershipPct: number | null;
  allocatedIncome: number | null;
  role: string | null;
};

const CONF: Record<string, string> = {
  high: "bg-green-50 text-green-700",
  medium: "bg-amber-50 text-amber-700",
  low: "bg-red-50 text-red-700",
};

const usd = (v: unknown) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(Number(v));

function banner(msg: string | undefined): string | null {
  if (!msg) return null;
  if (msg.startsWith("owners-")) {
    const n = parseInt(msg.slice(7), 10) || 0;
    return n > 0
      ? `Created ${n} ownership link${n > 1 ? "s" : ""} from the K-1.`
      : "All partners were already registered owners — nothing to add.";
  }
  if (msg.startsWith("class-")) return `Tax classification applied for ${msg.slice(6)}.`;
  return null;
}

export default async function TaxPage({
  searchParams,
}: {
  searchParams: Promise<{ msg?: string }>;
}) {
  const { msg } = await searchParams;
  const note = banner(msg);
  const [returns, ownerships, parties, companies] = await Promise.all([
    prisma.taxReturn.findMany({
      orderBy: { createdAt: "desc" },
      include: { company: true },
      omit: { pdf: true },
      take: 25,
    }),
    prisma.ownership.findMany(),
    prisma.party.findMany(),
    prisma.company.findMany(),
  ]);

  const partyById = new Map(parties.map((p) => [p.id, p.name]));
  const companyById = new Map(companies.map((c) => [c.id, c]));

  // Donos diretos cadastrados por empresa — cada um com TODOS os nomes conhecidos
  // (razão social + fantasia + aliases), para casar o sócio do K-1 mesmo com nome antigo.
  const registeredByCompany = new Map<string, { names: string[]; pct: number }[]>();
  for (const o of ownerships) {
    if (!o.ownedCompanyId) continue;
    let names: string[] | null = null;
    if (o.ownerPartyId) {
      const n = partyById.get(o.ownerPartyId);
      names = n ? [n] : null;
    } else if (o.ownerCompanyId) {
      const c = companyById.get(o.ownerCompanyId);
      names = c ? entityNames(c) : null;
    }
    if (!names) continue;
    const arr = registeredByCompany.get(o.ownedCompanyId) ?? [];
    arr.push({ names, pct: Number(o.percentage) });
    registeredByCompany.set(o.ownedCompanyId, arr);
  }

  function reconcile(companyId: string | null, partner: Owner) {
    if (!companyId) return null;
    const reg = registeredByCompany.get(companyId);
    if (!reg || reg.length === 0) return { status: "none" as const };
    const hit = reg.find((r) => ownerNameMatches(r.names, partner.name));
    if (!hit) return { status: "missing" as const };
    if (partner.ownershipPct == null) return { status: "registered" as const, pct: hit.pct };
    const diff = Math.abs(hit.pct - partner.ownershipPct);
    return diff <= 0.5
      ? { status: "match" as const, pct: hit.pct }
      : { status: "diff" as const, pct: hit.pct };
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Tax — IR analysis</h1>
        <p className="text-sm text-slate-500">
          Upload a tax return and Claude extracts the partners, financials and tax treatment, and
          checks the partners against the registered ownership.
        </p>
      </div>

      {note && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-2 text-sm text-green-800">
          {note}
        </div>
      )}

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
                      <div className="flex flex-wrap items-center gap-2">
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
                        {r.taxId ? ` · EIN/Tax ID ${r.taxId}` : ""}
                        {r.state ? ` · ${r.city ? `${r.city}, ` : ""}${r.state}` : ""}
                        {r.pdfSize != null ? (
                          <>
                            {" · "}
                            <a
                              href={`/api/tax-returns/${r.id}/pdf`}
                              target="_blank"
                              rel="noopener"
                              className="text-[#1f3a5f] hover:underline"
                            >
                              View PDF
                            </a>
                          </>
                        ) : (
                          <span className="text-slate-400"> · no PDF (re-upload to attach)</span>
                        )}
                      </p>
                    </div>
                    <div className="text-right text-sm">
                      <div className="text-slate-500">{r.taxForm ?? "—"}</div>
                      <div className="font-medium text-slate-800">
                        {r.taxTreatment ? labelForTaxTreatment(r.taxTreatment) : "—"}
                      </div>
                      <form action={deleteTaxReturn} className="mt-1">
                        <input type="hidden" name="id" value={r.id} />
                        <button className="text-xs text-slate-400 hover:text-red-600">
                          Delete
                        </button>
                      </form>
                    </div>
                  </div>

                  {/* Financials + metadata */}
                  <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-4">
                    <Field label="Ordinary income" value={usd(r.ordinaryIncome)} />
                    <Field label="Total income" value={usd(r.totalIncome)} />
                    <Field label="Net income" value={usd(r.netIncome)} />
                    <Field label="Responsible" value={r.responsible ?? "—"} />
                    {r.preparer && <Field label="Preparer" value={r.preparer} />}
                  </div>

                  {r.summary && <p className="mt-3 text-sm text-slate-600">{r.summary}</p>}

                  <div className="mt-4">
                    <div className="mb-1 text-xs font-medium text-slate-500">
                      Partners / shareholders ({owners.length}) — checked vs registered ownership
                    </div>
                    {owners.length === 0 ? (
                      <p className="text-sm text-slate-400">None found in the document.</p>
                    ) : (
                      <table className="w-full text-sm">
                        <tbody className="divide-y divide-slate-100">
                          {owners.map((o, i) => {
                            const rec = reconcile(r.companyId, o);
                            return (
                              <tr key={i}>
                                <td className="py-1.5 text-slate-700">
                                  {o.name}
                                  {o.taxIdLast4 && (
                                    <span className="ml-2 text-xs text-slate-400">
                                      {o.taxIdLast4}
                                    </span>
                                  )}
                                </td>
                                <td className="py-1.5 text-slate-500">{o.role ?? "—"}</td>
                                <td className="py-1.5 text-right tabular-nums text-slate-600">
                                  {usd(o.allocatedIncome)}
                                </td>
                                <td className="py-1.5 text-right tabular-nums text-slate-800">
                                  {o.ownershipPct != null ? `${o.ownershipPct}%` : "—"}
                                </td>
                                <td className="py-1.5 pl-3 text-right">
                                  <ReconBadge rec={rec} />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    )}
                  </div>

                  {(canApply || (r.companyId && owners.some((o) => o.ownershipPct != null))) && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
                      {canApply && r.status !== "APPLIED" && (
                        <form action={applyTaxReturnClassification}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="rounded-lg border border-[#1f3a5f] px-3 py-1.5 text-xs font-medium text-[#1f3a5f] hover:bg-[#1f3a5f]/[0.04]">
                            Apply {r.year} tax classification
                          </button>
                        </form>
                      )}
                      {r.companyId && owners.some((o) => o.ownershipPct != null) && (
                        <form action={applyTaxReturnOwnership}>
                          <input type="hidden" name="id" value={r.id} />
                          <button className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
                            Create ownership from K-1 ({r.year})
                          </button>
                        </form>
                      )}
                    </div>
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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-slate-700">{value}</div>
    </div>
  );
}

function ReconBadge({ rec }: { rec: { status: string; pct?: number } | null }) {
  if (!rec) return null;
  const map: Record<string, { label: string; cls: string }> = {
    match: { label: "matches ownership ✓", cls: "bg-green-50 text-green-700" },
    diff: { label: `differs (registered ${rec.pct}%)`, cls: "bg-red-50 text-red-700" },
    missing: { label: "not a registered owner", cls: "bg-amber-50 text-amber-700" },
    registered: { label: `registered ${rec.pct}%`, cls: "bg-slate-100 text-slate-500" },
    none: { label: "no ownership on file", cls: "bg-slate-100 text-slate-400" },
  };
  const m = map[rec.status];
  if (!m) return null;
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${m.cls}`}>{m.label}</span>
  );
}
