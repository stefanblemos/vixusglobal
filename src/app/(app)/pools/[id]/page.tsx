import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney, sum } from "@/lib/money";
import { byAddressNumber, capTable, houseEconomics, memberName } from "@/lib/pools/math";
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
import { AddPoolExpenseForm, CreateCapitalCallForm } from "@/components/pool-capital-forms";
import { deletePoolExpense, togglePoolExpensePaid } from "@/lib/actions/pools";
import { PoolTabsNav } from "@/components/pool-tabs";
import { AddMonthlyInterestForm } from "@/components/pool-interest-form";
import { buildStatement } from "@/lib/pools/loan-statement";

export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "Overview"],
  ["houses", "Casas"],
  ["investors", "Investidores"],
  ["interest", "Juros & reserve"],
  ["ledger", "Capital ledger"],
  ["distributions", "Distribuições"],
] as const;

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

export default async function PoolDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = TABS.some(([t]) => t === rawTab) ? (rawTab as string) : "overview";
  const pool = await prisma.investmentPool.findUnique({
    where: { id },
    include: {
      company: true,
      noteLoan: { include: { borrower: true } },
      houses: { include: { changeOrders: true } },
      members: { include: { entries: true, party: true, company: true } },
      distributions: { orderBy: { date: "asc" }, include: { lines: true, house: true } },
      capitalCalls: { orderBy: { date: "asc" }, include: { lines: true } },
      expenses: { orderBy: { date: "asc" } },
      loan: { include: { bankProfile: true, entries: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] } } },
      simulations: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: { scenario: true, bankProfile: true },
      },
    },
  });
  if (!pool) notFound();
  pool.houses.sort(byAddressNumber); // ordem crescente pelo número do endereço
  const sim = pool.simulations[0] ?? null;
  const simKpis = (sim?.result as { kpis?: Record<string, number | null> } | null)?.kpis ?? null;

  // Juros & reserve (do loan statement)
  const loanApr =
    pool.loan?.aprPct != null
      ? Number(pool.loan.aprPct)
      : pool.loan?.bankProfile
        ? pool.loan.bankProfile.rateType === "FIXED"
          ? Number(pool.loan.bankProfile.aprPct)
          : Number(pool.loan.bankProfile.indexPct) + Number(pool.loan.bankProfile.spreadPct)
        : null;
  const stmt = pool.loan
    ? buildStatement(
        pool.loan.entries.filter((e) => !e.pending).map((e) => ({
          id: e.id,
          type: e.type,
          date: e.date,
          amount: Number(e.amount),
          houseLabel: null,
          memo: e.memo,
          reconciled: e.reconciled,
          createdAt: e.createdAt,
        })),
        loanApr,
      )
    : null;
  const reserveFunded = pool.loan
    ? pool.loan.entries.filter((e) => e.type === "RESERVE").reduce((s, e) => s + Number(e.amount), 0)
    : 0;
  const reservePaidOut = pool.loan
    ? -pool.loan.entries
        .filter((e) => e.type === "INTEREST_PAYMENT")
        .reduce((s, e) => s + Number(e.amount), 0)
    : 0;
  const reserveRemaining = Math.round((reserveFunded - reservePaidOut) * 100) / 100 + 0 || 0;
  const reserveRefund = Math.max(0, Math.round((reservePaidOut - (stmt?.totalInterest ?? 0)) * 100) / 100);

  const table = capTable(pool.members);
  const memberById = new Map(pool.members.map((m) => [m.id, memberName(m)]));
  const entries = pool.members
    .flatMap((m) => m.entries.map((e) => ({ ...e, memberId: m.id })))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const sold = pool.houses.filter((h) => h.status === "SOLD").length;
  const distributed = sum(pool.distributions.map((d) => d.totalAmount));

  // Caixa & provisões: aportado × gasto × disponível (a diferença que o Stefan quer
  // sempre visível — sobra sem previsão de gasto pode voltar aos investidores)
  const spentOnHouses = sum(pool.houses.map((h) => h.ownCapital ?? 0));
  const receivedFromSales = sum(
    pool.houses.map((h) =>
      h.netReceived != null
        ? h.netReceived
        : h.soldPrice != null
          ? Number(h.soldPrice) - Number(h.payoffAmount ?? 0) - Number(h.closingCost ?? 0)
          : 0,
    ),
  );
  const expensesPaid = sum(pool.expenses.filter((e) => e.status === "PAID").map((e) => e.amount));
  const expensesProvisioned = sum(
    pool.expenses.filter((e) => e.status === "PROVISIONED").map((e) => e.amount),
  );
  const raised = sum(pool.members.flatMap((m) => m.entries.map((e) => (e.kind === "TRANSFER_OUT" ? -Number(e.amount) : Number(e.amount)))));
  const available = raised
    .add(receivedFromSales)
    .sub(spentOnHouses)
    .sub(expensesPaid)
    .sub(distributed);
  const freeToReturn = available.sub(expensesProvisioned);

  // somatórias do rodapé da tabela de casas (COs entram no lucro por custo)
  const houseEcos = pool.houses.map((h) =>
    houseEconomics(h, sum(h.changeOrders.map((c) => c.amount))),
  );
  const houseTotals = {
    plannedProfit: sum(houseEcos.map((e) => e.plannedProfit ?? 0)),
    ownCapital: sum(pool.houses.map((h) => h.ownCapital ?? 0)),
    soldPrice: sum(pool.houses.map((h) => h.soldPrice ?? 0)),
    received: sum(houseEcos.map((e) => e.cashAtClosing ?? 0)),
    realProfit: sum(houseEcos.map((e) => e.realProfit ?? 0)),
  };
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

      <PoolTabsNav poolId={pool.id} active={tab} />

      {/* Overview — premissas + esperado da simulação */}
      {tab === "overview" && (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-medium text-slate-800">Premissas do pool</h2>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-4 p-5 md:grid-cols-4">
              {(
                [
                  ["Início", fmtDate(pool.startDate)],
                  ["Término previsto", fmtDate(pool.plannedEndDate)],
                  ["Término real", fmtDate(pool.effectiveEndDate)],
                  [
                    "Forma de pagamento",
                    pool.loan
                      ? `Construction loan — ${pool.loan.bankProfile?.name ?? "banco a definir"}`
                      : sim?.fundingMode === "BANK"
                        ? `Construction loan — ${sim.bankProfile?.name ?? ""} (previsto)`
                        : "Equity (100% investidores)",
                  ],
                  [
                    "Aporte esperado",
                    pool.targetAmount ? formatMoney(pool.targetAmount, pool.currency) : "—",
                  ],
                  [
                    "Remuneração 4U",
                    pool.profitSharePct
                      ? `Performance ${(Number(pool.profitSharePct) * 100).toFixed(0)}% (antes do split)`
                      : "Contractor fee",
                  ],
                  ["Unit price", formatMoney(pool.unitPrice, pool.currency)],
                  ["Janela de captação até", fmtDate(pool.fundingDeadline)],
                  ["Closing do loan (previsto)", fmtDate(pool.loan?.expectedClosingDate)],
                  ["Closing do loan (real)", fmtDate(pool.loan?.closingDate)],
                ] as Array<[string, string]>
              ).map(([label, value]) => (
                <div key={label}>
                  <div className="text-xs text-slate-400">{label}</div>
                  <div className="text-sm font-medium text-slate-800">{value}</div>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-medium text-slate-800">Caixa & provisões</h2>
              <p className="text-xs text-slate-400">
                Aportado × gasto × disponível. Sobra sem previsão de gasto pode ser devolvida aos
                investidores (distribuição de retorno de capital). Despesas do pool saem do caixa
                antes do lucro — rateio automático pro rata às units.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-3 p-5 md:grid-cols-3">
              {(
                [
                  ["Aportado", formatMoney(raised, pool.currency), ""],
                  ["(−) Gasto nas casas (capital próprio)", formatMoney(spentOnHouses, pool.currency), ""],
                  ["(+) Recebido das vendas", formatMoney(receivedFromSales, pool.currency), ""],
                  ["(−) Despesas do pool pagas", formatMoney(expensesPaid, pool.currency), ""],
                  ["(−) Distribuído", formatMoney(distributed, pool.currency), ""],
                  ["= Disponível (estimado)", formatMoney(available, pool.currency), "font-semibold"],
                  ["(−) Provisões pendentes", formatMoney(expensesProvisioned, pool.currency), ""],
                  ["= Livre para devolução", formatMoney(freeToReturn, pool.currency), "font-semibold"],
                ] as Array<[string, string, string]>
              ).map(([label, value, cls]) => (
                <div key={label}>
                  <div className="text-xs text-slate-400">{label}</div>
                  <div className={`text-sm tabular-nums text-slate-800 ${cls}`}>{value}</div>
                </div>
              ))}
            </div>
            <div className="border-t border-slate-100">
              {pool.expenses.length > 0 && (
                <div className="divide-y divide-slate-50">
                  {pool.expenses.map((e) => (
                    <div key={e.id} className="flex items-center justify-between px-5 py-2 text-sm">
                      <span className="text-slate-500">{fmtDate(e.date)}</span>
                      <span className="flex-1 px-4 font-medium text-slate-700">{e.description}</span>
                      <span className="tabular-nums text-slate-800">{formatMoney(e.amount, pool.currency)}</span>
                      <form action={togglePoolExpensePaid} className="ml-3">
                        <input type="hidden" name="expenseId" value={e.id} />
                        <button
                          type="submit"
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            e.status === "PAID"
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                          }`}
                          title="Clique para alternar provisionada/paga"
                        >
                          {e.status === "PAID" ? "Paga" : "Provisionada"}
                        </button>
                      </form>
                      <form action={deletePoolExpense} className="ml-2">
                        <input type="hidden" name="expenseId" value={e.id} />
                        <button type="submit" className="text-xs text-slate-300 hover:text-red-500">✕</button>
                      </form>
                    </div>
                  ))}
                </div>
              )}
              <div className="border-t border-slate-100 px-5 py-4">
                <AddPoolExpenseForm poolId={pool.id} />
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-medium text-slate-800">Esperado — da simulação</h2>
              <p className="text-xs text-slate-400">
                {sim
                  ? `Simulação "${sim.name}" (cenário ${sim.scenario.name}) — o que foi apresentado aos investidores.`
                  : "Nenhuma simulação vinculada a este pool."}
              </p>
            </div>
            {sim && simKpis ? (
              <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-xs text-slate-400">Capital do investidor (pico)</div>
                  <div className="text-xl font-semibold tabular-nums text-slate-900">
                    {simKpis.peakCapital != null ? formatMoney(simKpis.peakCapital, pool.currency) : "—"}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-xs text-slate-400">Lucro esperado</div>
                  <div className="text-xl font-semibold tabular-nums text-slate-900">
                    {simKpis.profit != null ? formatMoney(simKpis.profit, pool.currency) : "—"}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-xs text-slate-400">TIR esperada (a.a.)</div>
                  <div className="text-xl font-semibold tabular-nums text-slate-900">
                    {simKpis.irrAnnual != null ? `${(simKpis.irrAnnual * 100).toFixed(1)}%` : "—"}
                  </div>
                </div>
                <div className="rounded-xl bg-slate-50 p-4">
                  <div className="text-xs text-slate-400">ROI (multiple)</div>
                  <div className="text-xl font-semibold tabular-nums text-slate-900">
                    {simKpis.equityMultiple != null ? `${simKpis.equityMultiple.toFixed(2)}x` : "—"}
                  </div>
                </div>
                <div className="col-span-2 px-1 lg:col-span-4">
                  <Link
                    href={`/pools/simulator/${sim.id}`}
                    className="text-xs text-[#1f3a5f] hover:underline"
                  >
                    Ver a simulação completa (ledger apresentado ao investidor) →
                  </Link>
                </div>
              </div>
            ) : (
              <p className="p-5 text-sm text-slate-400">
                Crie a simulação no{" "}
                <Link href="/pools/simulator" className="text-[#1f3a5f] hover:underline">
                  Simulator
                </Link>{" "}
                e converta em pool para os esperados aparecerem aqui — ou vincule uma simulação
                existente escolhendo este pool no campo "Link to pool".
              </p>
            )}
          </section>

          {pool.notes && (
            <section className="rounded-xl border border-slate-200 bg-white p-5">
              <div className="text-xs text-slate-400">Notas</div>
              <p className="mt-1 text-sm text-slate-600">{pool.notes}</p>
            </section>
          )}
        </div>
      )}

      {/* Casas */}
      {tab === "houses" && (
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-medium text-slate-800">Houses</h2>
          <p className="text-xs text-slate-400">
            "Recebido" = o que entrou em conta na venda (caixa, não lucro — o payoff do sweep
            amortiza o pool). "Lucro (custo)" = venda − closing − custos reais da casa; precisa
            do lote/obra reais preenchidos na ficha.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Address</th>
                <th className={th}>Status</th>
                <th className={thRight}>Lucro previsto</th>
                <th className={thRight}>Capital próprio</th>
                <th className={thRight}>Venda</th>
                <th className={thRight}>Recebido</th>
                <th className={thRight}>Lucro (custo)</th>
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
              {pool.houses.map((h, hi) => {
                const eco = houseEcos[hi];
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
                      {h.ownCapital ? formatMoney(h.ownCapital, pool.currency) : "—"}
                    </td>
                    <td className={tdRight}>
                      {h.soldPrice ? formatMoney(h.soldPrice, pool.currency) : "—"}
                    </td>
                    <td className={tdRight}>
                      {eco.cashAtClosing ? formatMoney(eco.cashAtClosing, pool.currency) : "—"}
                    </td>
                    <td
                      className={`${tdRight} ${eco.realProfit && eco.realProfit.isNegative() ? "text-red-600" : eco.realProfit ? "text-emerald-700" : ""}`}
                    >
                      {eco.realProfit ? formatMoney(eco.realProfit, pool.currency) : "—"}
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
              {pool.houses.length > 0 && (
                <tr className="bg-slate-50/60">
                  <td className={`${td} font-semibold text-slate-800`}>
                    Total ({pool.houses.length} casas)
                  </td>
                  <td className={td}></td>
                  <td className={`${tdRight} font-semibold`}>
                    {houseTotals.plannedProfit.isZero()
                      ? "—"
                      : formatMoney(houseTotals.plannedProfit, pool.currency)}
                  </td>
                  <td className={`${tdRight} font-semibold`}>
                    {formatMoney(houseTotals.ownCapital, pool.currency)}
                  </td>
                  <td className={`${tdRight} font-semibold`}>
                    {formatMoney(houseTotals.soldPrice, pool.currency)}
                  </td>
                  <td className={`${tdRight} font-semibold`}>
                    {formatMoney(houseTotals.received, pool.currency)}
                  </td>
                  <td className={`${tdRight} font-semibold`}>
                    {houseTotals.realProfit.isZero()
                      ? "—"
                      : formatMoney(houseTotals.realProfit, pool.currency)}
                  </td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-5 py-4">
          <AddHouseForm poolId={pool.id} />
        </div>
      </section>
      )}

      {/* Cap table */}
      {tab === "investors" && (
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
      )}

      {/* Capital calls (dentro da aba Investidores) */}
      {tab === "investors" && (
        <section className="rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="text-base font-medium text-slate-800">Capital calls</h2>
            <p className="text-xs text-slate-400">
              Quando custos e change orders passam do captado, a chamada rateia o valor pro rata
              às units e gera o relatório para os sócios.
            </p>
          </div>
          {pool.capitalCalls.length > 0 && (
            <div className="divide-y divide-slate-50">
              {pool.capitalCalls.map((c) => {
                const paidCount = c.lines.filter((l) => l.paid).length;
                return (
                  <Link
                    key={c.id}
                    href={`/pools/${pool.id}/calls/${c.id}`}
                    className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-slate-50/70"
                  >
                    <span className="text-slate-500">{fmtDate(c.date)}</span>
                    <span className="flex-1 px-4 font-medium text-slate-700">{c.reason}</span>
                    <span className="tabular-nums font-medium text-slate-800">
                      {formatMoney(c.totalAmount, pool.currency)}
                    </span>
                    <span
                      className={`ml-4 rounded-full px-2 py-0.5 text-xs ${
                        paidCount === c.lines.length
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700"
                      }`}
                    >
                      {paidCount}/{c.lines.length} recebidos
                    </span>
                  </Link>
                );
              })}
            </div>
          )}
          <div className="border-t border-slate-100 px-5 py-4">
            <CreateCapitalCallForm poolId={pool.id} suggestedAmount={null} />
          </div>
        </section>
      )}

      {/* Extrato de capital */}
      {tab === "ledger" && (
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
                    ) : e.kind === "CAPITAL_CALL" ? (
                      <span className="text-xs text-blue-700">Capital call</span>
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
      )}

      {/* Juros & reserve (do loan statement) */}
      {tab === "interest" && (
        <div className="space-y-4">
          {!pool.loan || !stmt ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
              O pool ainda não tem construction loan —{" "}
              <Link href={`/pools/${pool.id}/loan`} className="text-[#1f3a5f] hover:underline">
                crie os termos no Loan statement
              </Link>{" "}
              para acompanhar juros e reserve.
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-400">Reserve financiada</div>
                  <div className="text-xl font-semibold tabular-nums text-slate-900">
                    {formatMoney(reserveFunded, pool.currency)}
                  </div>
                  <div className="text-xs text-slate-400">capitalizada no loan</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-400">Juros reais cobrados</div>
                  <div className="text-xl font-semibold tabular-nums text-slate-900">
                    {formatMoney(stmt.totalInterest, pool.currency)}
                  </div>
                  <div className="text-xs text-slate-400">
                    esperado {formatMoney(stmt.totalExpectedInterest, pool.currency)}
                    {loanApr != null ? ` (APR ${loanApr}%)` : ""}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-400">Reserve restante</div>
                  <div className="text-xl font-semibold tabular-nums text-slate-900">
                    {formatMoney(reserveRemaining, pool.currency)}
                  </div>
                  <div className="text-xs text-slate-400">
                    {reserveRefund > 0
                      ? `devolvido na reconciliação: ${formatMoney(reserveRefund, pool.currency)}`
                      : "não usada volta na reconciliação"}
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="text-xs text-slate-400">Próximo mês (previsto)</div>
                  <div className="text-xl font-semibold tabular-nums text-slate-900">
                    {stmt.balance > 0 && loanApr != null
                      ? formatMoney((stmt.balance * loanApr) / 1200, pool.currency)
                      : "—"}
                  </div>
                  <div className="text-xs text-slate-400">
                    {stmt.balance > 0
                      ? `sobre o saldo atual de ${formatMoney(stmt.balance, pool.currency)}`
                      : "loan quitado"}
                  </div>
                </div>
              </div>

              <section className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-base font-medium text-slate-800">Juros por mês — previsto × realizado</h2>
                  <p className="text-xs text-slate-400">
                    "Esperado" = accrual diário (APR/360) sobre o saldo do statement. Desvio
                    acima de 5% fica em âmbar — confira a cobrança com o banco.
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full max-w-3xl">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className={th}>Data</th>
                        <th className={thRight}>Real (banco)</th>
                        <th className={thRight}>Esperado</th>
                        <th className={thRight}>Delta</th>
                        <th className={th}>Memo</th>
                        <th className={thRight}>✓</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stmt.rows.filter((r) => r.type === "INTEREST").length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-5 py-6 text-center text-sm text-slate-400">
                            Nenhum juro lançado ainda — use o formulário abaixo a cada extrato mensal.
                          </td>
                        </tr>
                      )}
                      {stmt.rows
                        .filter((r) => r.type === "INTEREST")
                        .map((r) => (
                          <tr key={r.id} className="border-b border-slate-50">
                            <td className={td}>{fmtDate(r.date)}</td>
                            <td className={`${tdRight} font-medium`}>{formatMoney(r.amount, pool.currency)}</td>
                            <td className={tdRight}>
                              {r.expectedInterest != null ? formatMoney(r.expectedInterest, pool.currency) : "—"}
                            </td>
                            <td
                              className={`${tdRight} ${
                                r.interestDelta != null &&
                                Math.abs(r.interestDelta) > Math.abs(r.expectedInterest ?? 0) * 0.05
                                  ? "text-amber-600"
                                  : "text-slate-400"
                              }`}
                            >
                              {r.interestDelta != null ? formatMoney(r.interestDelta, pool.currency) : "—"}
                            </td>
                            <td className={`${td} text-slate-400`}>{r.memo ?? ""}</td>
                            <td className={`${tdRight} ${r.reconciled ? "text-emerald-600" : "text-slate-300"}`}>✓</td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
                <div className="border-t border-slate-100 px-5 py-4">
                  <AddMonthlyInterestForm
                    poolId={pool.id}
                    hasReserve={reserveRemaining > 0}
                  />
                </div>
              </section>

              <p className="text-xs text-slate-400">
                O extrato completo do loan (draws, fees, payoffs) fica no{" "}
                <Link href={`/pools/${pool.id}/loan`} className="text-[#1f3a5f] hover:underline">
                  Loan statement
                </Link>
                .
              </p>
            </>
          )}
        </div>
      )}

      {/* Distribuições */}
      {tab === "distributions" && (
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
      )}
    </div>
  );
}
