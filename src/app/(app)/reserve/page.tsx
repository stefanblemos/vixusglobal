import Link from "next/link";
import {
  buildTaxReserve,
  buildQuarterlyReserve,
  buildReserveByEntity,
  reserveYears,
  QUARTER_DUE,
} from "@/lib/tax/reserve";
import { ReserveEntityTable } from "@/components/reserve-entity";
import { lockReserveYear, unlockReserveYear } from "@/lib/actions/reserve";
import { prisma } from "@/lib/db";
import { YearSelect } from "@/components/year-select";
import { CompletenessModal } from "@/components/completeness-modal";
import { buildGroupCompleteness } from "@/lib/tax/group-completeness";
import { ReserveDepositModal, type DepositRow } from "@/components/reserve-deposit-modal";
import { buildQuarterlyBreakdown } from "@/lib/tax/quarterly-breakdown";
import { QuarterlyBreakdown } from "@/components/quarterly-breakdown";

const money = (v: number | null, ccy = "USD") =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: ccy,
        maximumFractionDigits: 0,
      }).format(v);

export default async function ReservePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string; tab?: string }>;
}) {
  const { year: yearRaw, tab: tabRaw } = await searchParams;
  const years = await reserveYears();
  const fallbackYear = years[0] ?? new Date().getFullYear();
  const year = yearRaw && years.includes(Number(yearRaw)) ? Number(yearRaw) : fallbackYear;
  const TABS = [
    { key: "quarterly", label: "Quarterly" },
    { key: "annual", label: "By entity" },
  ];
  const tab = TABS.some((t) => t.key === tabRaw) ? tabRaw! : "quarterly";

  const [{ rows }, byEntity, { rows: qRows }, { rows: breakdown }, completeness, depositList] =
    await Promise.all([
      buildTaxReserve(year),
      buildReserveByEntity(year),
      buildQuarterlyReserve(year),
      buildQuarterlyBreakdown(year),
      buildGroupCompleteness(year),
      prisma.reserveDeposit.findMany({
        where: { year },
        include: { company: { select: { legalName: true } } },
        orderBy: [{ quarter: "asc" }, { createdAt: "asc" }],
      }),
    ]);
  const deposits: DepositRow[] = depositList.map((d) => ({
    id: d.id,
    company: d.company.legalName,
    quarter: d.quarter,
    amount: Number(d.amount.toString()),
    purpose: d.purpose,
    qboRef: d.qboRef,
    depositedAt: d.depositedAt ? d.depositedAt.toISOString().slice(0, 10) : null,
    note: d.note,
  }));
  const depositCompanies = qRows.map((q) => ({ id: q.companyId, name: q.name }));
  const lock = await prisma.reserveLock.findUnique({ where: { year } });
  const locked = !!lock;
  const lockedDate = lock ? new Date(lock.lockedAt).toISOString().slice(0, 10) : null;

  // Total a reservar por moeda (não dá pra somar USD + BRL + EUR).
  const totals = new Map<string, number>();
  for (const r of rows) totals.set(r.currency, (totals.get(r.currency) ?? 0) + r.reserve);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Tax reserve</h1>
          <p className="text-sm text-slate-500">
            How much profit to set aside for taxes. For the selected year, each company shows its
            profit and the slice to move into a dedicated tax-reserve account — so the cash is there
            when the bill comes.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CompletenessModal data={completeness} />
          {!locked && (
            <form action={lockReserveYear}>
              <input type="hidden" name="year" value={year} />
              <button
                className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
                title="Snapshot the provision and freeze the year"
              >
                Close &amp; lock {year}
              </button>
            </form>
          )}
          {years.length > 0 && <YearSelect years={years} value={year} basePath="/reserve" />}
        </div>
      </div>

      <div className="flex gap-1 border-b border-slate-200 text-sm">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/reserve?year=${year}&tab=${t.key}`}
            className={`-mb-px border-b-2 px-3 py-2 ${
              t.key === tab
                ? "border-[#1f3a5f] font-medium text-[#1f3a5f]"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {locked && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <span>
            <span className="font-medium">{year} locked</span> — provision snapshot taken{" "}
            {lockedDate}. The figures are frozen as a record; unlock to edit.
          </span>
          <form action={unlockReserveYear} className="ml-auto">
            <input type="hidden" name="year" value={year} />
            <button className="rounded-lg border border-amber-300 px-3 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100">
              Unlock
            </button>
          </form>
        </div>
      )}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No Profit &amp; Loss on file yet. Import one in{" "}
          <Link href="/import" className="text-[#1f3a5f] hover:underline">
            Documents
          </Link>{" "}
          to see the reserve.
        </div>
      ) : (
        <>
          {tab === "quarterly" && (
          <>
          <section className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-lg font-medium text-slate-800">Quarterly closing — needed vs funded</h2>
              {!locked && (
                <ReserveDepositModal year={year} companies={depositCompanies} deposits={deposits} />
              )}
            </div>
            <p className="text-sm text-slate-500">
              Per quarter, the amount to set aside (aligned to the estimated-tax deadlines) and what
              you&apos;ve actually moved into the reserve. Gap = still to fund.
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-4 py-2 font-medium">Company</th>
                    {QUARTER_DUE.map((due, i) => (
                      <th key={i} className="px-3 py-2 text-right font-medium">
                        Q{i + 1}
                        <span className="block text-[10px] font-normal text-slate-400">due {due}</span>
                      </th>
                    ))}
                    <th className="px-3 py-2 text-right font-medium">FY needed</th>
                    <th className="px-3 py-2 text-right font-medium">Funded</th>
                    <th className="px-4 py-2 text-right font-medium">Gap</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {qRows.map((q) => (
                    <tr key={q.companyId} className="hover:bg-slate-50">
                      <td className="px-4 py-2">
                        <Link
                          href={`/companies/${q.companyId}`}
                          className="font-medium text-[#1f3a5f] hover:underline"
                        >
                          {q.name}
                        </Link>
                        {q.annualOnly && (
                          <span className="ml-1 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500">
                            annual only
                          </span>
                        )}
                      </td>
                      {q.quarters.map((cell, i) => (
                        <td
                          key={i}
                          className="px-3 py-2 text-right tabular-nums text-slate-700"
                          title={`${cell.profit != null ? `Profit ${money(cell.profit, q.currency)} · ` : ""}Funded ${money(cell.funded, q.currency)}`}
                        >
                          {q.annualOnly ? (
                            <span className="text-slate-300">—</span>
                          ) : cell.profit == null ? (
                            <span className="text-slate-300">—</span>
                          ) : (
                            money(cell.reserve, q.currency)
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                        {money(q.fyReserve, q.currency)}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">
                        {money(q.fyFunded, q.currency)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-medium tabular-nums ${
                          q.fyGap <= 0.005 ? "text-emerald-600" : "text-rose-600"
                        }`}
                      >
                        {q.fyGap <= 0.005 ? "funded ✓" : money(q.fyGap, q.currency)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-slate-200 bg-slate-50/60">
                  {[...totals.entries()].map(([ccy]) => {
                    const qTot = [0, 1, 2, 3].map((i) =>
                      qRows
                        .filter((q) => q.currency === ccy && !q.annualOnly)
                        .reduce((s, q) => s + q.quarters[i].reserve, 0),
                    );
                    const inCcy = qRows.filter((q) => q.currency === ccy);
                    const fy = inCcy.reduce((s, q) => s + q.fyReserve, 0);
                    const funded = inCcy.reduce((s, q) => s + q.fyFunded, 0);
                    const gap = Math.round((fy - funded) * 100) / 100;
                    return (
                      <tr key={ccy}>
                        <td className="px-4 py-2 font-medium text-slate-700">Total ({ccy})</td>
                        {qTot.map((t, i) => (
                          <td key={i} className="px-3 py-2 text-right font-medium tabular-nums text-slate-700">
                            {money(t, ccy)}
                          </td>
                        ))}
                        <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">
                          {money(fy, ccy)}
                        </td>
                        <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-600">
                          {money(funded, ccy)}
                        </td>
                        <td
                          className={`px-4 py-2 text-right font-semibold tabular-nums ${
                            gap <= 0.005 ? "text-emerald-600" : "text-rose-600"
                          }`}
                        >
                          {gap <= 0.005 ? "funded ✓" : money(gap, ccy)}
                        </td>
                      </tr>
                    );
                  })}
                </tfoot>
              </table>
            </div>
          </section>
          <QuarterlyBreakdown rows={breakdown} />
          </>
          )}

          {tab === "annual" && (
            <section className="space-y-3">
              <div>
                <h2 className="text-lg font-medium text-slate-800">By entity — same base as the Tax preview</h2>
                <p className="text-sm text-slate-500">
                  Reserva por entidade sobre a <strong>mesma base</strong> do Tax preview (lucro book +
                  ajustes + depreciação real + K-1 cascateado). C-corp reserva 21% sobre a base (incl.
                  K-1 recebido); pessoa física na taxa de provisão; pass-through repassa (prejuízos
                  compensam pela cascata). Clique numa linha para o passo a passo.
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Stat label={`Total to reserve (${year})`} value={money(byEntity.totalReserve, "USD")} good />
                <Stat label="C-corps (21%)" value={money(byEntity.corpReserve, "USD")} />
                <Stat label="Individuals (provision)" value={money(byEntity.ownerReserve, "USD")} />
              </div>
              {byEntity.excludedNonUsd.length > 0 && (
                <p className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                  Fora deste cálculo (federal US, só USD): {byEntity.excludedNonUsd.join(", ")} — tributadas no próprio país.
                </p>
              )}
              {byEntity.excludedClosed.length > 0 && (
                <p className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs text-slate-600">
                  Encerradas (IR final já declarado) — fora do reserve: {byEntity.excludedClosed.join(", ")}.
                </p>
              )}
              <ReserveEntityTable rows={byEntity.rows} locked={locked} />
            </section>
          )}

          <p className="text-xs text-slate-400">
            Taxable profit = book net income; when the P&amp;L carries no depreciation, the{" "}
            <Link href="/assets" className="text-[#1f3a5f] hover:underline">
              real per-asset depreciation
            </Link>{" "}
            (book balances from the reconciliation; MACRS only if none is registered) is applied to the
            base. At the owner level, losses compensate profits, so
            the reserve is on the net base (the company table shows each entity&apos;s standalone
            figure). Direct ownership only, USD; reconcile against the actual return at year-end.{" "}
            <Link href="/florida" className="text-[#1f3a5f] hover:underline">
              Florida corporate tax →
            </Link>
          </p>
        </>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  good,
  muted,
}: {
  label: string;
  value: string;
  good?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={`mt-1 text-xl font-semibold ${
          good ? "text-emerald-600" : muted ? "text-slate-400" : "text-slate-800"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
