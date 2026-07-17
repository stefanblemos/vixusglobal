import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney, sum } from "@/lib/money";
import { byAddressNumber, capTable, houseEconomics, memberName } from "@/lib/pools/math";
import { PoolHousesTab } from "@/components/pool-houses-tab";
import { PoolLedgerTab } from "@/components/pool-ledger-tab";
import { PoolDistributionsTab } from "@/components/pool-distributions-tab";
import { PoolInvestorsTab } from "@/components/pool-investors-tab";
import { PoolStatusStepper } from "@/components/pool-status-stepper";
import { AddPoolExpenseForm } from "@/components/pool-capital-forms";
import { deletePoolExpense, togglePoolExpensePaid } from "@/lib/actions/pools";
import { PoolTabsNav } from "@/components/pool-tabs";
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
  searchParams: Promise<{ tab?: string; status?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab, status: rawStatus } = await searchParams;
  const tab = TABS.some(([t]) => t === rawTab) ? (rawTab as string) : "overview";
  // self-healing (16/07): status são derivados dos fatos — recomputa antes de carregar,
  // então qualquer status defasado (ex.: clique manual antigo) se corrige sozinho aqui
  const { recomputePoolStatuses } = await import("@/lib/pools/status-recompute");
  await recomputePoolStatuses(id);
  const pool = await prisma.investmentPool.findUnique({
    where: { id },
    include: {
      company: true,
      noteLoan: { include: { borrower: true } },
      houses: {
        include: {
          changeOrders: true,
          catalogModel: { select: { name: true } },
          catalogLocation: { select: { name: true } },
          loan: { include: { bankProfile: { select: { name: true } } } },
          // draws creditados → % de conclusão da obra (pedido A)
          loanEntries: { where: { type: "DRAW", pending: false }, select: { amount: true } },
        },
      },
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

  // contadores x/x nas fases (pedido B): as fases derivam das casas — o subtítulo mostra
  const housesStarted = pool.houses.filter((h) => h.status !== "PLANNED").length;
  const stepSubtitles: Record<string, string> = {
    FUNDING: `desde ${fmtDate(pool.startDate)}${pctRaised != null ? ` · ${pctRaised}% captado` : ""}`,
    ACTIVE: pool.houses.length > 0 ? `obras: ${housesStarted}/${pool.houses.length} casas` : "obras em curso",
    CLOSING: pool.houses.length > 0 ? `vendidas: ${sold}/${pool.houses.length}` : "vendas finais",
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

  // Capital ledger (mock 6/6): transferência pareada (transferGroupId) + captado acumulado
  type LedgerRowKind = "CONTRIBUTION" | "CAPITAL_CALL" | "TRANSFER" | "TRANSFER_IN" | "TRANSFER_OUT";
  const ledgerRows: Array<{
    id: string;
    date: string;
    kind: LedgerRowKind;
    memberName: string;
    amount: number;
    units: number;
    cumulative: number;
    memo: string | null;
    memberIds: string[];
  }> = [];
  {
    const seen = new Set<string>();
    let cum = 0;
    for (const e of entries) {
      if (e.transferGroupId) {
        if (seen.has(e.transferGroupId)) continue;
        seen.add(e.transferGroupId);
        const pair = entries.filter((x) => x.transferGroupId === e.transferGroupId);
        const out = pair.find((x) => x.kind === "TRANSFER_OUT") ?? pair[0];
        const inn = pair.find((x) => x.kind === "TRANSFER_IN");
        ledgerRows.push({
          id: out.id,
          date: fmtDate(out.date),
          kind: "TRANSFER",
          memberName: `${memberById.get(out.memberId) ?? "?"} → ${inn ? (memberById.get(inn.memberId) ?? "?") : "?"}`,
          amount: Number(out.amount),
          units: Number(out.units),
          cumulative: cum, // transferência não muda o captado
          memo: out.memo ?? inn?.memo ?? null,
          memberIds: pair.map((x) => x.memberId),
        });
      } else {
        cum += (e.kind === "TRANSFER_OUT" ? -1 : 1) * Number(e.amount);
        ledgerRows.push({
          id: e.id,
          date: fmtDate(e.date),
          kind: e.kind as LedgerRowKind,
          memberName: memberById.get(e.memberId) ?? "",
          amount: Number(e.amount),
          units: Number(e.units),
          cumulative: cum,
          memo: e.memo,
          memberIds: [e.memberId],
        });
      }
    }
  }

  // Distribuições (mock 6/6): linhas com rateio expandível + membros p/ preview pro rata
  const distRows = pool.distributions.map((d) => ({
    id: d.id,
    date: fmtDate(d.date),
    kind: d.kind as "RETURN_OF_CAPITAL" | "PROFIT",
    total: Number(d.totalAmount),
    house: d.house ? { id: d.house.id, address: d.house.address } : null,
    memo: d.memo,
    lines: d.lines.map((l) => ({ name: memberById.get(l.memberId) ?? "", amount: Number(l.amount) })),
  }));
  const distMembers = table.rows
    .filter((r) => r.units.gt(0))
    .map((r) => ({ name: r.name, units: Number(r.units) }));

  // Aba Casas (mock 4/6): linhas com contexto + % do previsto + pendências
  const houseRows = pool.houses.map((h, hi) => {
    const eco = houseEcos[hi];
    const plannedCost =
      h.plannedLotCost == null && h.plannedBuildCost == null
        ? null
        : Number(h.plannedLotCost ?? 0) + Number(h.plannedBuildCost ?? 0) + Number(h.plannedClosingCost ?? 0);
    const drawsCredited = h.loanEntries.reduce((s, e) => s + Number(e.amount), 0);
    return {
      id: h.id,
      address: h.address,
      status: h.status as string,
      // % de obra pelos draws (pedido A): CO = 100%; sem loan = sem régua
      buildPct:
        h.coDate != null
          ? 100
          : h.bankLoanAmount != null && Number(h.bankLoanAmount) > 0
            ? Math.min(100, Math.round((drawsCredited / Number(h.bankLoanAmount)) * 100))
            : null,
      model: h.catalogModel?.name ?? null,
      location: h.catalogLocation?.name ?? null,
      bank: h.loan?.bankProfile?.name ?? h.bankName ?? null,
      plannedProfit: eco.plannedProfit != null ? Number(eco.plannedProfit) : null,
      ownCapital: h.ownCapital != null ? Number(h.ownCapital) : null,
      ownNeeded: plannedCost != null ? plannedCost - Number(h.bankLoanAmount ?? 0) : null,
      soldPrice: h.soldPrice != null ? Number(h.soldPrice) : null,
      received: eco.cashAtClosing != null ? Number(eco.cashAtClosing) : null,
      realProfit: eco.realProfit != null ? Number(eco.realProfit) : null,
      // mesma régua da ficha: reais ainda vazios (lote, obra, venda, recebido)
      pending: [h.actualLotCost, h.actualBuildCost, h.soldPrice, h.netReceived].filter((v) => v == null).length,
    };
  });

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
            <PoolStatusStepper status={pool.status} subtitles={stepSubtitles} />
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
                    href={`/pools/${pool.id}?tab=houses&status=${status}`}
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

      {/* Casas (mock UX 4/6): filtro por status + busca, contexto na linha, pendencias */}
      {tab === "houses" && (
        <PoolHousesTab poolId={pool.id} rows={houseRows} initialStatus={rawStatus ?? null} />
      )}

      {/* Investidores (mock UX 2/6): captacao + acoes em painel + cap table visual + calls */}
      {tab === "investors" && (
        <PoolInvestorsTab
          poolId={pool.id}
          poolStatus={pool.status}
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

      {/* Capital ledger (mock UX 6/6): filtros, acumulado, transfer pareada, CSV */}
      {tab === "ledger" && (
        <PoolLedgerTab
          poolId={pool.id}
          rows={ledgerRows}
          members={memberOptions}
          raised={Number(raised)}
          totalUnits={Number(table.totalUnits)}
        />
      )}


      {/* Distribuicoes (mock UX 6/6): resumo, preview do rateio, linha expansivel */}
      {tab === "distributions" && (
        <PoolDistributionsTab
          poolId={pool.id}
          rows={distRows}
          houses={pool.houses.map((h) => ({ id: h.id, address: h.address }))}
          members={distMembers}
        />
      )}
    </div>
  );
}
