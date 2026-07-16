import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney, sum } from "@/lib/money";
import { byAddressNumber, capTable, houseEconomics, memberName } from "@/lib/pools/math";
import {
  deleteContribution,
  deleteDistribution,
  deleteHouse,
} from "@/lib/actions/pools";
import { AddHouseForm } from "@/components/pool-house-form";
import { AddDistributionForm } from "@/components/pool-investor-forms";
import { PoolInvestorsTab } from "@/components/pool-investors-tab";
import { PoolStatusStepper } from "@/components/pool-status-stepper";
import { AddPoolExpenseForm } from "@/components/pool-capital-forms";
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

// Prazos (mock 3/6 + pedido do Stefan): total em meses e dias + dias restantes,
// tanto do projeto quanto de cada loan (pool pode ter vários bancos).
const DAY_MS = 86400000;
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);
const addMonths = (d: Date, m: number) => {
  const x = new Date(d);
  x.setMonth(x.getMonth() + m);
  return x;
};
const monthsDays = (a: Date, b: Date) => {
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (addMonths(a, months) > b) months--;
  return { months, days: daysBetween(addMonths(a, months), b) };
};
const spanLabel = (a: Date, b: Date) => {
  const { months, days } = monthsDays(a, b);
  return `${months}m ${days}d (${daysBetween(a, b)} dias)`;
};
// restam N dias (verde/normal) ou vencido há N dias (vermelho)
function RemainingDays({ to, done }: { to: Date | null; done?: boolean }) {
  if (done) return <span className="text-slate-400">encerrado</span>;
  if (!to) return null;
  const rem = daysBetween(new Date(), to);
  return rem >= 0 ? (
    <span className={rem <= 30 ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>
      restam {rem} dias
    </span>
  ) : (
    <span className="font-semibold text-red-700">vencido há {-rem} dias</span>
  );
}

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
      loans: {
        orderBy: { createdAt: "asc" },
        include: { bankProfile: true, entries: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] } },
      },
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

  // Juros & reserve — um bloco por loan (pool pode ter vários bancos)
  const loanStats = pool.loans.map((loan) => {
    const apr =
      loan.aprPct != null
        ? Number(loan.aprPct)
        : loan.bankProfile
          ? loan.bankProfile.rateType === "FIXED"
            ? Number(loan.bankProfile.aprPct)
            : Number(loan.bankProfile.indexPct) + Number(loan.bankProfile.spreadPct)
          : null;
    const stmt = buildStatement(
      loan.entries.filter((e) => !e.pending).map((e) => ({
        id: e.id,
        type: e.type,
        date: e.date,
        amount: Number(e.amount),
        houseLabel: null,
        memo: e.memo,
        reconciled: e.reconciled,
        createdAt: e.createdAt,
      })),
      apr,
    );
    const reserveFunded = loan.entries
      .filter((e) => e.type === "RESERVE")
      .reduce((s, e) => s + Number(e.amount), 0);
    const reservePaidOut = -loan.entries
      .filter((e) => e.type === "INTEREST_PAYMENT")
      .reduce((s, e) => s + Number(e.amount), 0);
    const reserveRemaining = Math.round((reserveFunded - reservePaidOut) * 100) / 100 + 0 || 0;
    const reserveRefund = Math.max(0, Math.round((reservePaidOut - stmt.totalInterest) * 100) / 100);
    const label = `${loan.bankProfile?.name ?? "Banco a definir"}${loan.loanNumber ? ` · ${loan.loanNumber}` : ""}`;
    return { loan, label, apr, stmt, reserveFunded, reserveRemaining, reserveRefund };
  });

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

  // Aba Investidores (mock 2/6): linhas com saída legível — sócio que zerou via transferência
  // mostra a data e, quando o par TRANSFER_IN (mesma data e valor) é único, quem comprou.
  const investorRows = table.rows.map((r) => {
    const m = pool.members.find((mm) => mm.id === r.memberId)!;
    const hasEntries = m.entries.length > 0;
    let exited: { date: string; toName: string | null } | null = null;
    if (r.units.isZero() && hasEntries) {
      const outs = m.entries
        .filter((e) => e.kind === "TRANSFER_OUT")
        .sort((a, b) => a.date.getTime() - b.date.getTime());
      const last = outs[outs.length - 1];
      if (last) {
        const buyers = pool.members.filter(
          (mm) =>
            mm.id !== m.id &&
            mm.entries.some(
              (e) =>
                e.kind === "TRANSFER_IN" &&
                e.date.getTime() === last.date.getTime() &&
                Number(e.amount) === Number(last.amount),
            ),
        );
        exited = { date: fmtDate(last.date), toName: buyers.length === 1 ? memberName(buyers[0]) : null };
      }
    }
    return {
      memberId: r.memberId,
      name: r.name,
      role: r.role,
      invested: Number(r.invested),
      units: Number(r.units),
      pct: Number(r.pct),
      exited,
      hasEntries,
    };
  });
  const contribs = entries.filter((e) => e.kind === "CONTRIBUTION" || e.kind === "CAPITAL_CALL");
  const lastContrib = contribs[contribs.length - 1] ?? null;

  // ── Overview (mock 3/6): vida do pool, pendências, cascata do caixa, board de casas, prazos ──
  const raisedN = Number(raised);
  const targetN = pool.targetAmount != null ? Number(pool.targetAmount) : null;
  const pctRaised = targetN && targetN > 0 ? Math.round((raisedN / targetN) * 100) : null;
  const shortfall = targetN != null ? Math.max(0, targetN - raisedN) : null;
  const availableN = Number(available);
  // régua do alerta: caixa abaixo de 2% do captado com provisão ainda descoberta
  const lowCash = raisedN > 0 && availableN / raisedN < 0.02 && (shortfall ?? 0) > 0;

  const stepSubtitles: Record<string, string> = {
    FUNDING: `desde ${fmtDate(pool.startDate)}${pctRaised != null ? ` · ${pctRaised}% captado` : ""}`,
    ACTIVE: "obras em curso",
    CLOSING: "vendas finais",
    CLOSED: pool.effectiveEndDate
      ? `encerrado ${fmtDate(pool.effectiveEndDate)}`
      : `término prev. ${fmtDate(pool.plannedEndDate)}`,
  };
  const formaPagamento =
    pool.loans.length > 0
      ? `Construction loan — ${pool.loans.map((l) => l.bankProfile?.name ?? "banco a definir").join(" · ")}`
      : sim?.fundingMode === "BANK"
        ? `Construction loan — ${sim.bankProfile?.name ?? ""} (previsto)`
        : "Equity (100% investidores)";
  const pendencias: string[] = [
    ...(!pool.fundingDeadline ? ["janela de captação sem data — definir"] : []),
    ...pool.loans
      .filter((l) => !l.closingDate)
      .map((l) => `closing do loan não registrado — ${l.bankProfile?.name ?? "banco a definir"}`),
    ...(!pool.company ? ["entidade não vinculada (entity not linked)"] : []),
  ];

  const statusCounts = (Object.keys(HOUSE_STATUS_LABEL) as string[]).map((s) => ({
    status: s,
    count: pool.houses.filter((h) => h.status === s).length,
  }));
  // denúncia: dinheiro gasto mas status parados em Planned — os status estão atrasados
  const statusLag =
    Number(spentOnHouses) > 0 && pool.houses.length > 0 && pool.houses.every((h) => h.status === "PLANNED");

  // prazos por loan: closing (real ?? previsto) + termMonths do banco → maturity
  const loanTerms = pool.loans.map((l) => {
    const bank = l.bankProfile?.name ?? "banco a definir";
    const closing = l.closingDate ?? l.expectedClosingDate;
    const term = l.bankProfile?.termMonths ?? null;
    const maturity = closing && term ? addMonths(closing, term) : null;
    const ext = l.bankProfile?.extensionMonths ?? 0;
    return { id: l.id, bank, closing, usesExpected: !l.closingDate && !!l.expectedClosingDate, term, maturity, ext };
  });

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

      {/* Overview (mock UX 3/6): vida do pool + caixa em cascata + board de casas + prazos */}
      {tab === "overview" && (
        <div className="space-y-4">
          {/* vida do pool + pendências */}
          <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <h2 className="mb-2.5 text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
              Vida do pool
            </h2>
            <PoolStatusStepper poolId={pool.id} status={pool.status} subtitles={stepSubtitles} />
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {pendencias.map((p) => (
                <Link
                  key={p}
                  href={`/pools/${pool.id}/edit`}
                  className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-200"
                >
                  ⚠ {p}
                </Link>
              ))}
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-500">
                {formaPagamento}
              </span>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
            {/* caixa & provisões — cascata visual */}
            <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
                Caixa &amp; provisões
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Aportado × gasto × disponível — sobra sem previsão de gasto pode ser devolvida aos
                investidores. Despesas do pool saem do caixa antes do lucro.
              </p>
              <div className="mt-3 space-y-1.5">
                {(
                  [
                    ["Aportado", raisedN, "#1f3a5f", false],
                    ["− Gasto nas casas", Number(spentOnHouses), "#f59e0b", true],
                    ["+ Recebido das vendas", Number(receivedFromSales), "#16a34a", false],
                    ["− Despesas pagas", Number(expensesPaid), "#94a3b8", true],
                    ["− Distribuído", Number(distributed), "#94a3b8", true],
                  ] as Array<[string, number, string, boolean]>
                ).map(([label, v, color, neg]) => (
                  <div
                    key={label}
                    className="grid grid-cols-[150px_1fr_110px] items-center gap-2.5 text-xs"
                  >
                    <span className="text-slate-500">{label}</span>
                    <div className="h-3 rounded bg-slate-50">
                      {raisedN > 0 && v > 0 && (
                        <div
                          className="h-full rounded"
                          style={{
                            width: `${Math.min(100, (v / raisedN) * 100)}%`,
                            background: color,
                          }}
                        />
                      )}
                    </div>
                    <span
                      className={`text-right tabular-nums font-semibold ${
                        v === 0 ? "text-slate-300" : neg ? "text-amber-700" : "text-slate-700"
                      }`}
                    >
                      {neg && v > 0 ? "−" : ""}
                      {formatMoney(v, pool.currency)}
                    </span>
                  </div>
                ))}
              </div>
              <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[11px] text-slate-400">
                  Disponível hoje · livre para devolução
                </div>
                <div className="text-xl font-extrabold tabular-nums text-slate-800">
                  {formatMoney(freeToReturn, pool.currency)}
                </div>
                {Number(expensesProvisioned) > 0 && (
                  <div className="text-[11px] text-slate-400">
                    disponível {formatMoney(available, pool.currency)} − provisões pendentes{" "}
                    {formatMoney(expensesProvisioned, pool.currency)}
                  </div>
                )}
              </div>
              {lowCash && (
                <p className="mt-3 rounded-r-lg border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
                  Caixa em <b>{((availableN / raisedN) * 100).toFixed(1)}% do captado</b>
                  {shortfall != null && shortfall > 0 && (
                    <>
                      {" "}
                      e faltam <b>{formatMoney(shortfall, pool.currency)}</b> da provisão
                    </>
                  )}{" "}
                  — os próximos desembolsos dependem de novos aportes (aba Investidores) ou capital
                  call.
                </p>
              )}
              {pool.expenses.length > 0 && (
                <div className="mt-3 divide-y divide-slate-50 border-t border-slate-100">
                  {pool.expenses.map((e) => (
                    <div key={e.id} className="flex items-center justify-between py-2 text-sm">
                      <span className="text-slate-500">{fmtDate(e.date)}</span>
                      <span className="flex-1 px-4 font-medium text-slate-700">{e.description}</span>
                      <span className="tabular-nums text-slate-800">
                        {formatMoney(e.amount, pool.currency)}
                      </span>
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
                        <button type="submit" className="text-xs text-slate-300 hover:text-red-500">
                          ✕
                        </button>
                      </form>
                    </div>
                  ))}
                </div>
              )}
              {/* despesa sai do meio do card — abre só quando precisa */}
              <details className="mt-3">
                <summary className="inline-block cursor-pointer rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                  + Despesa
                </summary>
                <div className="mt-3">
                  <AddPoolExpenseForm poolId={pool.id} />
                </div>
              </details>
            </section>

            {/* casas — progresso por status */}
            <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
                Casas — progresso
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {sold} de {pool.houses.length} vendidas
                {!houseTotals.plannedProfit.isZero() &&
                  ` · lucro previsto ${formatMoney(houseTotals.plannedProfit, pool.currency)}`}
              </p>
              <div className="mt-3 space-y-1.5">
                {statusCounts.map(({ status, count }) => (
                  <Link
                    key={status}
                    href={`/pools/${pool.id}?tab=houses`}
                    className="grid grid-cols-[120px_1fr_28px] items-center gap-2.5 rounded text-xs hover:bg-slate-50"
                  >
                    <span className="text-slate-500">{HOUSE_STATUS_LABEL[status]}</span>
                    <div className="h-3 rounded bg-slate-50">
                      {count > 0 && (
                        <div
                          className={`h-full rounded ${
                            status === "SOLD"
                              ? "bg-emerald-500"
                              : status === "FOR_SALE" || status === "UNDER_CONTRACT"
                                ? "bg-blue-400"
                                : status === "PLANNED"
                                  ? "bg-slate-300"
                                  : "bg-amber-400"
                          }`}
                          style={{ width: `${(count / Math.max(1, pool.houses.length)) * 100}%` }}
                        />
                      )}
                    </div>
                    <span className="text-right font-bold tabular-nums text-slate-700">{count}</span>
                  </Link>
                ))}
              </div>
              {statusLag && (
                <p className="mt-3 rounded-r-lg border-l-2 border-amber-500 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
                  Todas as casas estão em Planned, mas o gasto de capital já é{" "}
                  <b>{formatMoney(spentOnHouses, pool.currency)}</b> — os status estão atrasados em
                  relação ao dinheiro. Atualize pelo stepper na ficha de cada casa.
                </p>
              )}
            </section>
          </div>

          {/* esperado — da simulação */}
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
                Esperado — da simulação
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                {sim
                  ? `Simulação "${sim.name}" (cenário ${sim.scenario.name}) — o que foi apresentado aos investidores.`
                  : "Nenhuma simulação vinculada a este pool."}{" "}
                {sim && (
                  <Link href={`/pools/simulator/${sim.id}`} className="text-[#1f3a5f] underline hover:no-underline">
                    Ver ledger completo →
                  </Link>
                )}
              </p>
            </div>
            {sim && simKpis ? (
              <div className="grid grid-cols-2 gap-3 p-4 lg:grid-cols-4">
                {(
                  [
                    [
                      "Capital do investidor (pico)",
                      simKpis.peakCapital != null ? formatMoney(simKpis.peakCapital, pool.currency) : "—",
                    ],
                    ["Lucro esperado", simKpis.profit != null ? formatMoney(simKpis.profit, pool.currency) : "—"],
                    ["TIR esperada (a.a.)", simKpis.irrAnnual != null ? `${(simKpis.irrAnnual * 100).toFixed(1)}%` : "—"],
                    ["ROI (multiple)", simKpis.equityMultiple != null ? `${simKpis.equityMultiple.toFixed(2)}x` : "—"],
                  ] as Array<[string, string]>
                ).map(([label, value]) => (
                  <div key={label} className="rounded-xl bg-slate-50 p-4">
                    <div className="text-xs text-slate-400">{label}</div>
                    <div className="text-xl font-semibold tabular-nums text-slate-900">{value}</div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="p-5 text-sm text-slate-400">
                Crie a simulação no{" "}
                <Link href="/pools/simulator" className="text-[#1f3a5f] hover:underline">
                  Simulator
                </Link>{" "}
                e converta em pool para os esperados aparecerem aqui — ou vincule uma simulação
                existente escolhendo este pool no campo &quot;Link to pool&quot;.
              </p>
            )}
          </section>

          {/* premissas compactas + prazos (projeto e por loan) */}
          <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
                Premissas do pool
              </h2>
              <Link
                href={`/pools/${pool.id}/edit`}
                className="rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-100"
              >
                Edit pool
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-x-8 gap-y-4 md:grid-cols-3">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Início</div>
                <div className="text-sm font-semibold text-slate-800">{fmtDate(pool.startDate)}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Término previsto / real</div>
                <div className="text-sm font-semibold text-slate-800">
                  {fmtDate(pool.plannedEndDate)} /{" "}
                  {pool.effectiveEndDate ? fmtDate(pool.effectiveEndDate) : <span className="text-amber-700">—</span>}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Prazo do projeto</div>
                <div className="text-sm font-semibold text-slate-800">
                  {pool.startDate && pool.plannedEndDate ? (
                    <>
                      {spanLabel(pool.startDate, pool.effectiveEndDate ?? pool.plannedEndDate)} ·{" "}
                      <RemainingDays to={pool.plannedEndDate} done={!!pool.effectiveEndDate} />
                    </>
                  ) : (
                    <span className="text-amber-700">— definir início/término</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Forma de pagamento</div>
                <div className="text-sm font-semibold text-slate-800">{formaPagamento}</div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Aporte esperado</div>
                <div className="text-sm font-semibold text-slate-800">
                  {pool.targetAmount ? formatMoney(pool.targetAmount, pool.currency) : "—"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Remuneração 4U</div>
                <div className="text-sm font-semibold text-slate-800">
                  {pool.profitSharePct
                    ? `Performance ${(Number(pool.profitSharePct) * 100).toFixed(0)}% (antes do split)`
                    : "Contractor fee"}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Unit price</div>
                <div className="text-sm font-semibold text-slate-800">
                  {formatMoney(pool.unitPrice, pool.currency)}
                </div>
              </div>
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Janela de captação até</div>
                <div className="text-sm font-semibold text-slate-800">
                  {pool.fundingDeadline ? (
                    fmtDate(pool.fundingDeadline)
                  ) : (
                    <span className="text-amber-700">— definir</span>
                  )}
                </div>
              </div>
              {loanTerms.map((lt) => (
                <div key={lt.id}>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Prazo do loan — {lt.bank}
                  </div>
                  <div className="text-sm font-semibold text-slate-800">
                    {lt.closing && lt.term && lt.maturity ? (
                      <>
                        {spanLabel(lt.closing, lt.maturity)}
                        {lt.usesExpected && <span className="font-normal text-slate-400"> (closing prev.)</span>} ·{" "}
                        <RemainingDays to={lt.maturity} />
                        {lt.ext > 0 && (
                          <span className="font-normal text-slate-400"> · +{lt.ext}m ext. possível</span>
                        )}
                      </>
                    ) : (
                      <span className="text-amber-700">— registrar closing do loan</span>
                    )}
                  </div>
                </div>
              ))}
              {pool.loans.map((l) => (
                <div key={`closing-${l.id}`}>
                  <div className="text-[10px] uppercase tracking-wider text-slate-400">
                    Closing do loan — {l.bankProfile?.name ?? "banco a definir"}
                  </div>
                  <div className="text-sm font-semibold text-slate-800">
                    prev. {fmtDate(l.expectedClosingDate)} · real{" "}
                    {l.closingDate ? fmtDate(l.closingDate) : <span className="text-amber-700">—</span>}
                  </div>
                </div>
              ))}
            </div>
            {pool.notes && (
              <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-500">
                <span className="text-slate-400">Notas:</span> {pool.notes}
              </p>
            )}
          </section>
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

      {/* Investidores (mock UX 2/6): captacao + acoes em painel + cap table visual + calls */}
      {tab === "investors" && (
        <PoolInvestorsTab
          poolId={pool.id}
          raised={Number(raised)}
          target={pool.targetAmount != null ? Number(pool.targetAmount) : null}
          totalUnits={Number(table.totalUnits)}
          unitPrice={Number(pool.unitPrice)}
          rows={investorRows}
          lastContribution={
            lastContrib
              ? {
                  name: memberById.get(lastContrib.memberId) ?? "",
                  amount: Number(lastContrib.amount),
                  date: fmtDate(lastContrib.date),
                }
              : null
          }
          capitalCalls={pool.capitalCalls.map((c) => ({
            id: c.id,
            date: fmtDate(c.date),
            reason: c.reason,
            total: Number(c.totalAmount),
            paidCount: c.lines.filter((l) => l.paid).length,
            lineCount: c.lines.length,
          }))}
          memberOptions={memberOptions}
          ownerOptions={ownerOptions}
          suggestedCallAmount={null}
        />
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

      {/* Juros & reserve (do loan statement) — um bloco por loan */}
      {tab === "interest" && (
        <div className="space-y-8">
          {loanStats.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
              O pool ainda não tem construction loan —{" "}
              <Link href={`/pools/${pool.id}/loan`} className="text-[#1f3a5f] hover:underline">
                crie os termos no Loan statement
              </Link>{" "}
              para acompanhar juros e reserve.
            </div>
          ) : (
            loanStats.map(({ loan, label, apr, stmt, reserveFunded, reserveRemaining, reserveRefund }) => (
            <div key={loan.id} className="space-y-4">
              {loanStats.length > 1 && (
                <h2 className="text-base font-semibold text-slate-800">{label}</h2>
              )}
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
                    {apr != null ? ` (APR ${apr}%)` : ""}
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
                    {stmt.balance > 0 && apr != null
                      ? formatMoney((stmt.balance * apr) / 1200, pool.currency)
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
                    loanId={loan.id}
                    hasReserve={reserveRemaining > 0}
                  />
                </div>
              </section>
            </div>
            ))
          )}
          {loanStats.length > 0 && (
            <p className="text-xs text-slate-400">
              O extrato completo de cada loan (draws, fees, payoffs) fica no{" "}
              <Link href={`/pools/${pool.id}/loan`} className="text-[#1f3a5f] hover:underline">
                Loan statement
              </Link>
              .
            </p>
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
