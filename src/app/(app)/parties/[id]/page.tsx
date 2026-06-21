import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { labelForJurisdiction, labelForPartyKind } from "@/lib/catalog";
import { crossCheckPersonalReturn, looseNameMatch } from "@/lib/personal/reconcile";
import { MergePartyInto } from "@/components/merge-party-into";

export const dynamic = "force-dynamic";

const num = (v: unknown) => (v == null ? null : Number(v));
const money = (v: unknown) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(Number(v));
const pct = (v: number | null) =>
  v == null ? "—" : `${(v * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;

export default async function PartyDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [party, allReturns, entityReturns, companies, ownerships, parties] = await Promise.all([
    prisma.party.findUnique({ where: { id } }),
    prisma.personalReturn.findMany({ omit: { pdf: true } }),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null } },
      select: { companyId: true, year: true, taxTreatment: true, owners: true },
    }),
    prisma.company.findMany({ select: { id: true, legalName: true } }),
    prisma.ownership.findMany({
      where: { ownerPartyId: id },
      orderBy: { percentage: "desc" },
    }),
    prisma.party.findMany({ select: { id: true, name: true, kind: true } }),
  ]);
  if (!party) notFound();

  // Outros registros do mesmo tipo — candidatos a serem a mesma pessoa (merge manual).
  const otherParties = parties.filter((p) => p.id !== id && p.kind === party.kind);

  const companyById = new Map(companies.map((c) => [c.id, c.legalName]));
  const companyNameById = companyById;
  const partyNameById = new Map(parties.map((p) => [p.id, p.name]));

  // Declarações desta pessoa: ligadas a ela, OU conjuntas em que ela é o cônjuge
  // (o transcript trunca o nome — looseNameMatch resolve "S BRAG LEMO" = "Stefan Braga Lemos").
  const returns = allReturns
    .filter(
      (r) =>
        r.partyId === id ||
        (r.matchedName && looseNameMatch(party.name, r.matchedName)) ||
        (r.spouseName && looseNameMatch(party.name, r.spouseName)),
    )
    .sort((a, b) => (b.year ?? 0) - (a.year ?? 0));

  const entRows = entityReturns.map((r) => ({
    companyId: r.companyId,
    year: r.year,
    taxTreatment: r.taxTreatment,
    owners: r.owners as { name: string; allocatedIncome: number | null }[] | null,
  }));

  const latest = returns[0];
  const isSpouse = !!latest && !!latest.spouseName && looseNameMatch(party.name, latest.spouseName);
  const ssnLast4 = latest ? (isSpouse ? latest.spouseSsnLast4 : latest.ssnLast4) : null;

  const totalIncomes = returns.map((r) => num(r.totalIncome) ?? 0);
  const maxIncome = Math.max(1, ...totalIncomes.map(Math.abs));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/parties" className="text-sm text-slate-500 hover:text-slate-700">
          ← Owners
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold text-slate-800">{party.name}</h1>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {labelForPartyKind(party.kind)}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            {labelForJurisdiction(party.taxJurisdiction)}
          </span>
          {ssnLast4 && (
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
              SSN •••-••-{ssnLast4}
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-slate-500">
          {returns.length > 0
            ? `${returns.length} personal return${returns.length > 1 ? "s" : ""} on file · ${ownerships.length} holding${ownerships.length !== 1 ? "s" : ""}`
            : "No personal returns on file yet."}
        </p>
      </div>

      {latest && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Kpi label={`Total income (${latest.year})`} value={money(latest.totalIncome)} />
          <Kpi label="AGI" value={money(latest.agi)} />
          <Kpi label="Total tax" value={money(latest.totalTax)} />
          <Kpi
            label="Effective rate"
            value={pct(
              num(latest.totalTax) != null && num(latest.totalIncome)
                ? (num(latest.totalTax) as number) / (num(latest.totalIncome) as number)
                : null,
            )}
          />
        </div>
      )}

      {returns.length > 0 ? (
        <>
          {/* Linha do tempo tributária — visão multi-ano */}
          <section className="space-y-2">
            <h2 className="text-lg font-medium text-slate-800">Tax history</h2>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Year</th>
                    <th className="px-4 py-2 font-medium">Income (relative)</th>
                    <th className="px-4 py-2 text-right font-medium">Wages</th>
                    <th className="px-4 py-2 text-right font-medium">Sch C</th>
                    <th className="px-4 py-2 text-right font-medium">Sch E (partnership)</th>
                    <th className="px-4 py-2 text-right font-medium">Total income</th>
                    <th className="px-4 py-2 text-right font-medium">SE tax</th>
                    <th className="px-4 py-2 text-right font-medium">Total tax</th>
                    <th className="px-4 py-2 font-medium">K-1 check</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {returns.map((r) => {
                    const schE =
                      r.partnershipIncome == null && r.partnershipLoss == null
                        ? null
                        : (num(r.partnershipIncome) ?? 0) - (num(r.partnershipLoss) ?? 0);
                    const inc = num(r.totalIncome) ?? 0;
                    const w = Math.round((Math.abs(inc) / maxIncome) * 100);
                    const cc = crossCheckPersonalReturn(
                      {
                        matchedName: r.matchedName,
                        spouseName: r.spouseName,
                        year: r.year,
                        partnershipIncome: num(r.partnershipIncome),
                        partnershipLoss: num(r.partnershipLoss),
                        ordinaryDividends: num(r.ordinaryDividends),
                      },
                      entRows,
                      companyNameById,
                    );
                    return (
                      <tr key={r.id} className="hover:bg-slate-50/60">
                        <td className="px-4 py-2 font-medium text-slate-800">{r.year ?? "—"}</td>
                        <td className="px-4 py-2">
                          <div className="h-2 w-32 overflow-hidden rounded-full bg-slate-100">
                            <div
                              className="h-full rounded-full bg-[#1f3a5f]"
                              style={{ width: `${w}%` }}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                          {money(r.wages)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                          {money(r.businessIncomeC)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right tabular-nums ${schE != null && schE < 0 ? "text-red-600" : "text-slate-600"}`}
                        >
                          {schE == null ? "—" : money(schE)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums font-medium text-slate-800">
                          {money(r.totalIncome)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                          {money(r.seTax)}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums text-slate-600">
                          {money(r.totalTax)}
                        </td>
                        <td className="px-4 py-2">
                          <CrossBadge status={cc.status} gap={cc.gap} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-slate-400">
              Each year&rsquo;s 1040 figures. &ldquo;K-1 check&rdquo; cross-checks the Schedule E
              partnership total against the K-1s this person&rsquo;s LLCs issued that year.
            </p>
          </section>

          {/* Cruzamento K-1 por ano (detalhado) */}
          <section className="space-y-2">
            <h2 className="text-lg font-medium text-slate-800">K-1 cross-check by year</h2>
            <div className="space-y-3">
              {returns.map((r) => {
                const cc = crossCheckPersonalReturn(
                  {
                    matchedName: r.matchedName,
                    spouseName: r.spouseName,
                    year: r.year,
                    partnershipIncome: num(r.partnershipIncome),
                    partnershipLoss: num(r.partnershipLoss),
                    ordinaryDividends: num(r.ordinaryDividends),
                  },
                  entRows,
                  companyNameById,
                );
                return (
                  <details key={r.id} className="rounded-xl border border-slate-200 bg-white">
                    <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 px-4 py-3">
                      <span className="font-medium text-slate-800">
                        {r.year} · {r.fileName}
                      </span>
                      <CrossBadge status={cc.status} gap={cc.gap} />
                    </summary>
                    <div className="border-t border-slate-100 px-4 py-3">
                      {cc.contributions.length === 0 ? (
                        <p className="text-sm text-slate-400">
                          No registered LLC allocated income to this person in {r.year} — nothing to
                          cross-check (their loss/income may come from entities not yet loaded).
                        </p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead className="text-left text-xs text-slate-400">
                            <tr>
                              <th className="py-1 font-medium">LLC (issuer)</th>
                              <th className="py-1 text-right font-medium">Allocated</th>
                            </tr>
                          </thead>
                          <tbody>
                            {cc.contributions.map((c, i) => (
                              <tr key={i} className="border-t border-slate-50">
                                <td className="py-1.5">
                                  <Link
                                    href={`/companies/${c.entityId}/year/${c.year}`}
                                    className="text-[#1f3a5f] hover:underline"
                                  >
                                    {c.entityName}
                                  </Link>
                                  <span className="ml-2 text-xs text-slate-400">{c.ownerName}</span>
                                </td>
                                <td
                                  className={`py-1.5 text-right tabular-nums ${c.allocated < 0 ? "text-red-600" : "text-slate-700"}`}
                                >
                                  {money(c.allocated)}
                                </td>
                              </tr>
                            ))}
                            <tr className="border-t-2 border-slate-200 font-medium">
                              <td className="py-1.5 text-slate-700">Expected (sum of K-1s)</td>
                              <td className="py-1.5 text-right tabular-nums text-slate-900">
                                {money(cc.expectedTotal)}
                              </td>
                            </tr>
                            <tr>
                              <td className="py-1.5 text-slate-600">Reported on 1040 (Sch E net)</td>
                              <td className="py-1.5 text-right tabular-nums text-slate-700">
                                {cc.reportedNet == null ? "—" : money(cc.reportedNet)}
                              </td>
                            </tr>
                            {cc.gap != null &&
                              Math.abs(cc.gap) > Math.max(1, Math.abs(cc.expectedTotal) * 0.02) && (
                                <tr className="font-medium text-red-700">
                                  <td className="py-1.5">Gap — review</td>
                                  <td className="py-1.5 text-right tabular-nums">{money(cc.gap)}</td>
                                </tr>
                              )}
                          </tbody>
                        </table>
                      )}
                      {cc.cCorpHoldings.length > 0 && (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50/50 p-2.5 text-xs text-slate-500">
                          <span className="font-medium text-slate-600">
                            C-corp holdings (taxed at the entity, dividends only):
                          </span>{" "}
                          {cc.cCorpHoldings.map((h, i) => (
                            <span key={h.entityId}>
                              {i > 0 && ", "}
                              <Link
                                href={`/companies/${h.entityId}/year/${h.year}`}
                                className="text-[#1f3a5f] hover:underline"
                              >
                                {h.entityName}
                              </Link>
                            </span>
                          ))}
                          . The 1120 income doesn&rsquo;t flow to the 1040 — only dividends
                          {cc.dividendsReported != null ? ` (reported: ${money(cc.dividendsReported)})` : ""}.
                        </div>
                      )}
                    </div>
                  </details>
                );
              })}
            </div>
          </section>
        </>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No personal returns on file. Upload them in{" "}
          <Link href="/tax/personal" className="text-[#1f3a5f] hover:underline">
            Tax → Personal returns
          </Link>
          .
        </div>
      )}

      {/* Participações da pessoa */}
      {ownerships.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium text-slate-800">Holdings</h2>
          <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-2 font-medium">Entity</th>
                  <th className="px-4 py-2 text-right font-medium">Stake</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {ownerships.map((o) => {
                  const name = o.ownedCompanyId
                    ? companyById.get(o.ownedCompanyId)
                    : o.ownedPartyId
                      ? partyNameById.get(o.ownedPartyId)
                      : null;
                  return (
                    <tr key={o.id} className="hover:bg-slate-50/60">
                      <td className="px-4 py-2">
                        {o.ownedCompanyId ? (
                          <Link
                            href={`/companies/${o.ownedCompanyId}`}
                            className="text-[#1f3a5f] hover:underline"
                          >
                            {name ?? o.ownedCompanyId}
                          </Link>
                        ) : (
                          <span className="text-slate-700">{name ?? "—"}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                        {Number(o.percentage).toLocaleString("en-US", { maximumFractionDigits: 4 })}%
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Mesclar pessoa duplicada (nomes divergentes) */}
      {party.kind === "PERSON" && (
        <section className="space-y-2">
          <h2 className="text-lg font-medium text-slate-800">Mesclar registro duplicado</h2>
          <p className="text-sm text-slate-500">
            Se a mesma pessoa está cadastrada com nome diferente, selecione o outro registro para
            mesclá-lo nesta. Participações, declarações (1040) e vendores do razão passam para{" "}
            <span className="font-medium text-slate-700">{party.name}</span>, o nome do duplicado
            vira alias (imports futuros casam) e o registro extra é removido.
          </p>
          {party.aliases.length > 0 && (
            <p className="text-xs text-slate-500">
              <span className="text-slate-400">Também conhecida como:</span>{" "}
              {party.aliases.join(" · ")}
            </p>
          )}
          {otherParties.length > 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <MergePartyInto keepId={party.id} keepName={party.name} others={otherParties} />
            </div>
          ) : (
            <p className="text-sm text-slate-400">Nenhum outro registro de pessoa para mesclar.</p>
          )}
        </section>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="mt-1 text-xl font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function CrossBadge({ status, gap }: { status: string; gap: number | null }) {
  if (status === "match")
    return (
      <span className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-700">
        matches ✓
      </span>
    );
  if (status === "diff")
    return (
      <span className="rounded-full bg-red-50 px-2 py-0.5 text-xs text-red-700">
        gap {gap != null ? money(gap) : "—"}
      </span>
    );
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">no data</span>
  );
}
