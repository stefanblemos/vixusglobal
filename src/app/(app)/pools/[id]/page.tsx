import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney, sum } from "@/lib/money";
import { capTable, houseEconomics, memberName } from "@/lib/pools/math";
import {
  deleteContribution,
  deleteDistribution,
  deleteHouse,
  deleteMember,
} from "@/lib/actions/pools";
import { AddHouseForm } from "@/components/pool-house-form";
import {
  AddContributionForm,
  AddDistributionForm,
  AddMemberForm,
  TransferUnitsForm,
} from "@/components/pool-investor-forms";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  FUNDING: "bg-amber-50 text-amber-700",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  CLOSING: "bg-blue-50 text-blue-700",
  CLOSED: "bg-slate-100 text-slate-500",
};

const HOUSE_STATUS_LABEL: Record<string, string> = {
  PLANNED: "Planned",
  LOT_PURCHASED: "Lot purchased",
  UNDER_CONSTRUCTION: "Construction",
  FOR_SALE: "For sale",
  UNDER_CONTRACT: "Under contract",
  SOLD: "Sold",
};

const HOUSE_STATUS_STYLE: Record<string, string> = {
  PLANNED: "bg-slate-100 text-slate-500",
  LOT_PURCHASED: "bg-amber-50 text-amber-700",
  UNDER_CONSTRUCTION: "bg-amber-50 text-amber-700",
  FOR_SALE: "bg-blue-50 text-blue-700",
  UNDER_CONTRACT: "bg-blue-50 text-blue-700",
  SOLD: "bg-emerald-50 text-emerald-700",
};

const fmtDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-2 text-sm text-slate-600";
const tdRight = "px-3 py-2 text-right text-sm tabular-nums text-slate-700";

export default async function PoolDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await prisma.investmentPool.findUnique({
    where: { id },
    include: {
      company: true,
      noteLoan: { include: { borrower: true } },
      houses: { orderBy: { createdAt: "asc" } },
      members: { include: { entries: true, party: true, company: true } },
      distributions: { orderBy: { date: "asc" }, include: { lines: true, house: true } },
    },
  });
  if (!pool) notFound();

  const table = capTable(pool.members);
  const memberById = new Map(pool.members.map((m) => [m.id, memberName(m)]));
  const entries = pool.members
    .flatMap((m) => m.entries.map((e) => ({ ...e, memberId: m.id })))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const sold = pool.houses.filter((h) => h.status === "SOLD").length;
  const distributed = sum(pool.distributions.map((d) => d.totalAmount));
  const memberOptions = table.rows.map((r) => ({
    id: r.memberId,
    name: r.name,
    role: r.role,
  }));

  // Sócios candidatos: todas as Parties + Companies que ainda não são membros.
  const [parties, companies] = await Promise.all([
    prisma.party.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.company.findMany({ orderBy: { legalName: "asc" }, select: { id: true, legalName: true } }),
  ]);
  const taken = new Set(
    pool.members.map((m) => (m.partyId ? `party:${m.partyId}` : `company:${m.companyId}`)),
  );
  const ownerOptions = [
    ...companies.map((c) => ({ value: `company:${c.id}`, label: c.legalName })),
    ...parties.map((p) => ({ value: `party:${p.id}`, label: `${p.name} (person)` })),
  ].filter((o) => !taken.has(o.value));

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/pools" className="text-sm text-slate-500 hover:text-slate-700">
            ← Pools
          </Link>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-semibold text-slate-800">{pool.name}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[pool.status] ?? ""}`}>
              {pool.status}
            </span>
          </div>
          <p className="text-sm text-slate-500">
            {pool.code}
            {pool.alias ? ` · ${pool.alias}` : ""}
            {pool.company ? ` · entity: ${pool.company.legalName}` : " · entity not linked yet"}
            {pool.noteLoan ? ` · note to ${pool.noteLoan.borrower.legalName}` : ""}
          </p>
        </div>
        <Link
          href={`/pools/${pool.id}/edit`}
          className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Edit pool
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-400">Raised</div>
          <div className="text-xl font-semibold tabular-nums text-slate-900">
            {formatMoney(table.totalInvested, pool.currency)}
          </div>
          <div className="text-xs text-slate-400">
            {pool.targetAmount ? `target ${formatMoney(pool.targetAmount, pool.currency)}` : "no target set"}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-400">Units issued</div>
          <div className="text-xl font-semibold tabular-nums text-slate-900">
            {table.totalUnits.toFixed(2)}
          </div>
          <div className="text-xs text-slate-400">
            unit price {formatMoney(pool.unitPrice, pool.currency)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-400">Houses</div>
          <div className="text-xl font-semibold tabular-nums text-slate-900">
            {sold}/{pool.houses.length} <span className="text-sm font-normal text-slate-400">sold</span>
          </div>
          <div className="text-xs text-slate-400">
            funding deadline {fmtDate(pool.fundingDeadline)}
          </div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-400">Distributed</div>
          <div className="text-xl font-semibold tabular-nums text-slate-900">
            {formatMoney(distributed, pool.currency)}
          </div>
          <div className="text-xs text-slate-400">
            {pool.profitSharePct
              ? `investor profit share ${Number(pool.profitSharePct) * 100}%`
              : "profit share not set"}
          </div>
        </div>
      </div>

      {/* Casas */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-medium text-slate-800">Houses</h2>
          <p className="text-xs text-slate-400">
            Pro forma vs. actuals per house. Open a house to fill bank terms and results.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Address</th>
                <th className={th}>Status</th>
                <th className={thRight}>Planned profit</th>
                <th className={thRight}>Bank loan</th>
                <th className={thRight}>Own capital</th>
                <th className={thRight}>Sold price</th>
                <th className={thRight}>Result</th>
                <th className={thRight}></th>
              </tr>
            </thead>
            <tbody>
              {pool.houses.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-6 text-center text-sm text-slate-400">
                    No houses yet — add the first one below.
                  </td>
                </tr>
              )}
              {pool.houses.map((h) => {
                const eco = houseEconomics(h);
                return (
                  <tr key={h.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className={td}>
                      <Link
                        href={`/pools/${pool.id}/houses/${h.id}`}
                        className="font-medium text-[#1f3a5f] hover:underline"
                      >
                        {h.address}
                      </Link>
                    </td>
                    <td className={td}>
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs ${HOUSE_STATUS_STYLE[h.status] ?? ""}`}
                      >
                        {HOUSE_STATUS_LABEL[h.status] ?? h.status}
                      </span>
                    </td>
                    <td className={tdRight}>
                      {eco.plannedProfit ? formatMoney(eco.plannedProfit, pool.currency) : "—"}
                    </td>
                    <td className={tdRight}>
                      {h.bankLoanAmount ? formatMoney(h.bankLoanAmount, pool.currency) : "—"}
                    </td>
                    <td className={tdRight}>
                      {h.ownCapital ? formatMoney(h.ownCapital, pool.currency) : "—"}
                    </td>
                    <td className={tdRight}>
                      {h.soldPrice ? formatMoney(h.soldPrice, pool.currency) : "—"}
                    </td>
                    <td
                      className={`${tdRight} ${eco.result && eco.result.isNegative() ? "text-red-600" : eco.result ? "text-emerald-700" : ""}`}
                    >
                      {eco.result ? formatMoney(eco.result, pool.currency) : "—"}
                    </td>
                    <td className={tdRight}>
                      <form action={deleteHouse}>
                        <input type="hidden" name="houseId" value={h.id} />
                        <button
                          type="submit"
                          className="text-xs text-slate-300 hover:text-red-500"
                          title="Delete house"
                        >
                          ✕
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-5 py-4">
          <AddHouseForm poolId={pool.id} />
        </div>
      </section>

      {/* Cap table */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-medium text-slate-800">Cap table</h2>
          <p className="text-xs text-slate-400">
            Percentages are derived from units — never typed. Transfers move units without
            diluting anyone.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Member</th>
                <th className={th}>Role</th>
                <th className={thRight}>Invested</th>
                <th className={thRight}>Units</th>
                <th className={thRight}>%</th>
                <th className={thRight}></th>
              </tr>
            </thead>
            <tbody>
              {table.rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-sm text-slate-400">
                    No members yet — add the manager (Vixus) and the investor companies below.
                  </td>
                </tr>
              )}
              {table.rows.map((r) => (
                <tr key={r.memberId} className="border-b border-slate-50">
                  <td className={`${td} font-medium text-slate-800`}>{r.name}</td>
                  <td className={td}>
                    {r.role === "MANAGER" ? (
                      <span className="rounded-full bg-[#1f3a5f]/10 px-2 py-0.5 text-xs text-[#1f3a5f]">
                        Manager
                      </span>
                    ) : (
                      <span className="text-xs text-slate-400">Investor</span>
                    )}
                  </td>
                  <td className={tdRight}>{formatMoney(r.invested, pool.currency)}</td>
                  <td className={tdRight}>{r.units.toFixed(2)}</td>
                  <td className={`${tdRight} font-medium`}>{r.pct.toFixed(2)}%</td>
                  <td className={tdRight}>
                    {r.units.isZero() && (
                      <form action={deleteMember}>
                        <input type="hidden" name="memberId" value={r.memberId} />
                        <button
                          type="submit"
                          className="text-xs text-slate-300 hover:text-red-500"
                          title="Remove member"
                        >
                          ✕
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {table.rows.length > 0 && (
                <tr className="bg-slate-50/60">
                  <td className={`${td} font-semibold text-slate-800`}>Total</td>
                  <td className={td}></td>
                  <td className={`${tdRight} font-semibold`}>
                    {formatMoney(table.totalInvested, pool.currency)}
                  </td>
                  <td className={`${tdRight} font-semibold`}>{table.totalUnits.toFixed(2)}</td>
                  <td className={`${tdRight} font-semibold`}>
                    {table.totalUnits.isZero() ? "—" : "100.00%"}
                  </td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="space-y-4 border-t border-slate-100 px-5 py-4">
          <AddMemberForm poolId={pool.id} owners={ownerOptions} />
          <AddContributionForm poolId={pool.id} members={memberOptions} />
          <TransferUnitsForm poolId={pool.id} members={memberOptions} />
        </div>
      </section>

      {/* Extrato de capital */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-medium text-slate-800">Capital ledger</h2>
          <p className="text-xs text-slate-400">
            Every contribution and unit transfer, in order — the source of the investor statements.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Date</th>
                <th className={th}>Member</th>
                <th className={th}>Kind</th>
                <th className={thRight}>Amount</th>
                <th className={thRight}>Units</th>
                <th className={th}>Memo</th>
                <th className={thRight}></th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-sm text-slate-400">
                    No capital entries yet.
                  </td>
                </tr>
              )}
              {entries.map((e) => (
                <tr key={e.id} className="border-b border-slate-50">
                  <td className={td}>{fmtDate(e.date)}</td>
                  <td className={`${td} font-medium text-slate-800`}>
                    {memberById.get(e.memberId)}
                  </td>
                  <td className={td}>
                    {e.kind === "CONTRIBUTION" ? (
                      <span className="text-xs text-slate-500">Contribution</span>
                    ) : e.kind === "TRANSFER_IN" ? (
                      <span className="text-xs text-emerald-700">Transfer in</span>
                    ) : (
                      <span className="text-xs text-amber-700">Transfer out</span>
                    )}
                  </td>
                  <td className={`${tdRight} ${e.kind === "TRANSFER_OUT" ? "text-amber-700" : ""}`}>
                    {e.kind === "TRANSFER_OUT" ? "−" : ""}
                    {formatMoney(e.amount, pool.currency)}
                  </td>
                  <td className={tdRight}>{Number(e.units).toFixed(2)}</td>
                  <td className={`${td} text-slate-400`}>{e.memo ?? ""}</td>
                  <td className={tdRight}>
                    <form action={deleteContribution}>
                      <input type="hidden" name="entryId" value={e.id} />
                      <input type="hidden" name="poolId" value={pool.id} />
                      <button
                        type="submit"
                        className="text-xs text-slate-300 hover:text-red-500"
                        title={e.transferGroupId ? "Delete transfer (both sides)" : "Delete entry"}
                      >
                        ✕
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Distribuições */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-medium text-slate-800">Distributions</h2>
          <p className="text-xs text-slate-400">
            Return of capital and profit, split pro rata by units at the distribution date.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Date</th>
                <th className={th}>Kind</th>
                <th className={thRight}>Total</th>
                <th className={th}>From sale of</th>
                <th className={th}>Memo</th>
                <th className={thRight}>Members</th>
                <th className={thRight}></th>
              </tr>
            </thead>
            <tbody>
              {pool.distributions.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-sm text-slate-400">
                    No distributions yet.
                  </td>
                </tr>
              )}
              {pool.distributions.map((d) => (
                <tr key={d.id} className="border-b border-slate-50">
                  <td className={td}>{fmtDate(d.date)}</td>
                  <td className={td}>
                    {d.kind === "RETURN_OF_CAPITAL" ? (
                      <span className="text-xs text-slate-500">Return of capital</span>
                    ) : (
                      <span className="text-xs text-emerald-700">Profit</span>
                    )}
                  </td>
                  <td className={`${tdRight} font-medium`}>
                    {formatMoney(d.totalAmount, pool.currency)}
                  </td>
                  <td className={`${td} text-slate-400`}>{d.house?.address ?? "—"}</td>
                  <td className={`${td} text-slate-400`}>{d.memo ?? ""}</td>
                  <td className={tdRight}>{d.lines.length}</td>
                  <td className={tdRight}>
                    <form action={deleteDistribution}>
                      <input type="hidden" name="distributionId" value={d.id} />
                      <button
                        type="submit"
                        className="text-xs text-slate-300 hover:text-red-500"
                        title="Delete distribution"
                      >
                        ✕
                      </button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-5 py-4">
          <AddDistributionForm
            poolId={pool.id}
            houses={pool.houses.map((h) => ({ id: h.id, address: h.address }))}
          />
        </div>
      </section>
    </div>
  );
}
