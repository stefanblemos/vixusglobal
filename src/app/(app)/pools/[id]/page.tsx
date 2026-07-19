import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
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
import { computeSuffAggs, poolLoanSurplus } from "@/lib/pools/loan-sufficiency";
import { buildActivityFeed } from "@/lib/pools/activity-feed";
import { computeNav, liveIrr, type NavHouse } from "@/lib/pools/nav";
import { buildRisk, mesAno } from "@/lib/pools/risk";
import { ncStatsForLocation } from "@/lib/pools/benchmark";
import { INV_LANG_COOKIE, langFromCookie, tOf } from "@/lib/pools/i18n";
import { LangToggle } from "@/components/lang-toggle";
import { PoolDataRoom } from "@/components/pool-dataroom";

export const dynamic = "force-dynamic";

const TABS = [
  ["overview", "Overview"],
  ["houses", "Casas"],
  ["investors", "Investidores"],
] as const;

// sub-abas de Investidores (layout 18/07 + Fase 3): labels bilíngues vêm do dicionário
const INVESTOR_SUBS = ["members", "ledger", "distributions", "dataroom"] as const;

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

const fmtDate = (d: Date | null | undefined) => (d ? d.toISOString().slice(0, 10) : "—");

export default async function PoolDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; status?: string; sub?: string; view?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab, status: rawStatus, sub: rawSub, view: rawView } = await searchParams;
  // links antigos (?tab=ledger / ?tab=distributions) caem nas sub-abas de Investidores
  const legacySub = rawTab === "ledger" ? "ledger" : rawTab === "distributions" ? "distributions" : null;
  const tab = legacySub ? "investors" : TABS.some(([t]) => t === rawTab) ? (rawTab as string) : "overview";
  const invSub = INVESTOR_SUBS.some((s) => s === (legacySub ?? rawSub))
    ? ((legacySub ?? rawSub) as string)
    : "members";
  const housesView = rawView === "market" ? "market" : "board"; // toggle Board | Mercado
  // i18n (Fase 3): conteúdo pelo seletor EN|PT (cookie); datas pelo locale do navegador
  const cookieStore = await cookies();
  const lang = langFromCookie(cookieStore.get(INV_LANG_COOKIE)?.value);
  const t = tOf(lang);
  const hdrs = await headers();
  const dateLocale = hdrs.get("accept-language")?.split(",")[0]?.trim() || "en-US";
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
      // data room (Fase 3): docs do pool SEM os bytes (pdfSize diz se tem arquivo)
      documents: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          docType: true,
          fileName: true,
          createdAt: true,
          portalVisible: true,
          pdfSize: true,
          memberId: true,
          reportMonth: true,
        },
      },
      loans: {
        orderBy: { createdAt: "asc" },
        include: {
          bankProfile: true,
          entries: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
          // suficiência (fonte única): cobranças pendentes vêm da leitura dos documentos
          documents: {
            select: { id: true, fileName: true, kind: true, extracted: true, createdAt: true, portalVisible: true },
          },
        },
      },
      simulations: {
        orderBy: { updatedAt: "desc" },
        take: 1,
        include: { scenario: true, bankProfile: true },
      },
      // subscrições online (Leva 2): convite → wizard → assinatura → aceite do Manager
      subscriptions: {
        orderBy: { createdAt: "desc" },
        include: { party: { select: { name: true } }, company: { select: { legalName: true } } },
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

  // subscrições online — origin p/ montar o link do convite (mesmo host da request)
  const subscribeOrigin = `${hdrs.get("x-forwarded-proto") ?? "http"}://${hdrs.get("host") ?? "localhost:3005"}`;
  const subscriptionRows = pool.subscriptions.map((s) => {
    const data = (s.data ?? {}) as { legalName?: string };
    const who = data.legalName?.trim() || s.party?.name || s.company?.legalName || s.email || "Investidor sem nome";
    const units = s.units != null ? Number(s.units) : null;
    return {
      id: s.id,
      token: s.token,
      who,
      units,
      commitment: units != null ? units * Number(s.unitPrice) : null,
      status: s.status,
      prefilled: s.prefilled,
      signedAt: s.signedAt ? fmtDate(s.signedAt) : null,
      createdAt: fmtDate(s.createdAt),
    };
  });
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
  // pendências com DESTINO certo (17/07): cada badge leva ao lugar onde se resolve
  const pendencias: Array<{ text: string; href: string }> = [
    ...(!pool.fundingDeadline
      ? [{ text: "janela de captação sem data → Edit pool", href: `/pools/${pool.id}/edit` }]
      : []),
    ...pool.loans
      .filter((l) => !l.closingDate)
      .map((l) => ({
        text: `registrar closing — ${l.bankProfile?.name?.split(" ")[0] ?? "banco"} → Termos`,
        href: `/pools/${pool.id}/loan?loan=${l.id}&stab=terms`,
      })),
    ...(!pool.company
      ? [{ text: "vincular entidade → Edit pool", href: `/pools/${pool.id}/edit` }]
      : []),
  ];

  // aporte estimado LÍQUIDO dos loans (17/07): a sobra da suficiência abate a captação
  const suffAggs = computeSuffAggs(pool, new Date());
  const loanSurplus = poolLoanSurplus(suffAggs);
  const aporteLiquido = shortfall != null ? Math.max(0, shortfall - loanSurplus) : null;

  // Feed do pool (Fase 0 investor-grade, 18/07): timeline derivada dos dados existentes
  const houseAddrById = new Map(pool.houses.map((h) => [h.id, h.address]));
  const feed = buildActivityFeed(
    {
      members: pool.members.map((m) => ({
        name: memberName(m),
        entries: m.entries.map((e) => ({ kind: e.kind, date: e.date, amount: e.amount })),
      })),
      loans: pool.loans.map((l) => ({
        bankName: l.bankProfile?.name ?? null,
        entries: l.entries.map((e) => ({
          type: e.type,
          date: e.date,
          amount: e.amount,
          pending: e.pending,
          houseAddress: e.houseId ? houseAddrById.get(e.houseId) ?? null : null,
        })),
        documents: l.documents.map((d) => ({ kind: d.kind, fileName: d.fileName, createdAt: d.createdAt })),
      })),
      houses: pool.houses,
      distributions: pool.distributions.map((d) => ({
        date: d.date,
        amount: d.lines.reduce((s, l) => s + Number(l.amount), 0),
      })),
      expenses: pool.expenses,
      currency: pool.currency,
    },
    20,
  );

  // ── Marcação & retorno (Fase 1 investor-grade, mock aprovado 18/07) ──
  const baselineSaleByHouse = (() => {
    const b = pool.scheduleBaseline as { houses?: Array<{ houseId: string; sale: string | null }> } | null;
    return new Map((b?.houses ?? []).map((h) => [h.houseId, h.sale ? new Date(h.sale) : null]));
  })();
  const navHouses: NavHouse[] = pool.houses.map((h) => {
    const drawn = h.loanEntries.reduce((s, e) => s + Number(e.amount), 0);
    const cost =
      Number(h.plannedLotCost ?? 0) + Number(h.plannedBuildCost ?? 0) + Number(h.plannedClosingCost ?? 0);
    const expectedProfit = h.plannedSalePrice != null && cost > 0 ? Number(h.plannedSalePrice) - cost : null;
    const drawable = h.bankLoanAmount != null ? Number(h.bankLoanAmount) : null;
    const buildPct = h.coDate ? 100 : drawable && drawable > 0 ? Math.min(100, (drawn / drawable) * 100) : 0;
    return {
      ownCapital: Number(h.ownCapital ?? 0),
      bankDrawn: drawn,
      expectedProfit,
      buildPct,
      sold: h.saleDate != null,
      baselineSale: baselineSaleByHouse.get(h.id) ?? null,
    };
  });
  const poolDebt = pool.loans.reduce(
    (s, l) => s + Math.max(0, l.entries.filter((e) => !e.pending).reduce((x, e) => x + Number(e.amount), 0)),
    0,
  );
  // drag de financiamento: fees/reserve/juros consumidos + estimados (OTHER fica fora — é crédito)
  const financingIncurred = pool.loans
    .flatMap((l) => l.entries)
    .filter((e) => !e.pending && ["CLOSING_FEE", "RESERVE", "DRAW_FEE", "INTEREST"].includes(e.type))
    .reduce((s, e) => s + Number(e.amount), 0);
  const financingProjected = suffAggs
    .filter((a) => !a.quitado)
    .reduce((s, a) => s + a.jurosEst + a.drawFeeEst, 0);
  const live = liveIrr({
    contributions: contribs.map((e) => ({ date: e.date, amount: Number(e.amount) })),
    distributions: pool.distributions.map((d) => ({
      date: d.date,
      amount: d.lines.reduce((s, l) => s + Number(l.amount), 0),
    })),
    houses: navHouses,
    financingDrag: financingIncurred + financingProjected,
    today: new Date(),
  });
  const navR = computeNav({
    freeCash: Number(freeToReturn),
    houses: navHouses,
    debt: poolDebt,
    unitsTotal: Number(table.totalUnits),
    raised: raisedN,
    distributed: Number(distributed),
    projectedProfitNet: live.profitNet,
  });
  const planIrr = simKpis?.irrAnnual != null ? Number(simKpis.irrAnnual) : null;
  const planMultiple = simKpis?.equityMultiple != null ? Number(simKpis.equityMultiple) : null;
  const tvpi = raisedN > 0 ? (navR.nav + Number(distributed)) / raisedN : null;
  const dpi = raisedN > 0 ? Number(distributed) / raisedN : null;
  const unitPar = Number(pool.unitPrice);

  // lucro por casa × mercado ATTOM (farol pelos percentis de NC vendidas do submercado)
  const marketRows = pool.houses.map((h) => {
    const cost =
      Number(h.plannedLotCost ?? 0) + Number(h.plannedBuildCost ?? 0) + Number(h.plannedClosingCost ?? 0);
    const sale = h.plannedSalePrice != null ? Number(h.plannedSalePrice) : null;
    const margin = sale != null && cost > 0 ? sale - cost : null;
    const marginPct = margin != null && cost > 0 ? (margin / cost) * 100 : null;
    const stats = h.catalogLocation ? ncStatsForLocation(h.catalogLocation.name) : null;
    let verdict: { label: string; tone: "green" | "amber" | "red" } = { label: "✓ dentro da faixa", tone: "green" };
    if (sale != null && stats) {
      if (sale > stats.max) verdict = { label: "⚠ acima do teto observado", tone: "red" };
      else if (sale >= stats.p90) verdict = { label: "△ acima do p90", tone: "amber" };
    }
    if (verdict.tone === "green" && marginPct != null && marginPct < 5)
      verdict = { label: `△ margem fina (${marginPct.toFixed(1)}%)`, tone: "amber" };
    return {
      id: h.id,
      addr: h.address.split(",")[0],
      model: h.catalogModel?.name ?? "—",
      loc: h.catalogLocation?.name ?? "—",
      cost,
      sale,
      margin,
      stats,
      verdict,
      sold: h.saleDate != null,
    };
  });

  // prazo do projeto SEMPRE visível (17/07): início → fim, decorrido e restantes
  const prazo = (() => {
    const start = pool.startDate;
    const end = pool.effectiveEndDate ?? pool.plannedEndDate;
    if (!start || !end) return null;
    const dayMsP = 86_400_000;
    const total = Math.max(1, Math.round((end.getTime() - start.getTime()) / dayMsP));
    const gone = Math.min(total, Math.max(0, Math.round((Date.now() - start.getTime()) / dayMsP)));
    const left = Math.round((end.getTime() - Date.now()) / dayMsP);
    return { start, end, total, gone, left, pct: Math.round((gone / total) * 100) };
  })();

  // Fase 2 (mock aprovado 18/07): risco & caixa futuro — card do Overview + KPI da régua
  const risk = buildRisk(pool, new Date());

  // Layout novo (mock aprovado 18/07): valores compactos p/ régua + cards do Overview
  const fmtCompact = (v: number) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: pool.currency,
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(v);
    } catch {
      return String(Math.round(v));
    }
  };
  const marketAlerts = marketRows.filter((r) => !r.sold && r.verdict.tone !== "green");
  // "descoberto do envelope": casas cujo disponível do banco já não cobre o necessário
  const envelopeShortRows = suffAggs
    .filter((a) => !a.quitado)
    .flatMap((a) => a.rows)
    .filter((r) => (r.delta ?? 0) < -0.01);

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

  return (
    <div className="space-y-5">
      {/* Header em 1 bloco (layout novo 18/07): título + status + prazo fundido + Edit */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div>
          <Link href="/pools" className="text-xs text-slate-400 hover:text-slate-600">
            ← Pools
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-slate-800">{pool.name}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[pool.status] ?? ""}`}>
              {pool.status}
            </span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
              {pool.code}
              {pool.alias ? ` · ${pool.alias}` : ""}
              {pool.company ? ` · ${pool.company.legalName}` : " · entity not linked"}
              {pool.noteLoan ? ` · note to ${pool.noteLoan.borrower.legalName}` : ""}
            </span>
          </div>
        </div>
        {prazo && (
          <div className="ml-auto flex items-center gap-2 text-[11px] text-slate-500">
            <span className="tabular-nums">
              {fmtDate(prazo.start)} → {fmtDate(prazo.end)}
            </span>
            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
              <div
                className={`h-full rounded-full ${prazo.left < 30 ? "bg-red-500" : prazo.left < 90 ? "bg-amber-500" : "bg-[#1f3a5f]"}`}
                style={{ width: `${prazo.pct}%` }}
              />
            </div>
            <span
              className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold tabular-nums ${
                prazo.left < 0
                  ? "bg-red-100 text-red-700"
                  : prazo.left < 90
                    ? "bg-amber-50 text-amber-700"
                    : "bg-emerald-50 text-emerald-700"
              }`}
              title={`${Math.round(prazo.total / 30)} meses · ${prazo.total}d · ${prazo.pct}% decorrido`}
            >
              {prazo.left < 0 ? `estourado há ${-prazo.left}d` : `restam ${prazo.left}d`}
            </span>
          </div>
        )}
        <div className={`${prazo ? "" : "ml-auto "}flex items-center gap-2`}>
          {/* seletor EN|PT (Fase 3): vale p/ o módulo todo; datas seguem o locale do Windows */}
          <LangToggle lang={lang} />
          <Link
            href={`/pools/${pool.id}/edit`}
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100"
          >
            Edit pool
          </Link>
        </div>
      </div>

      {/* Régua ÚNICA de 6 KPIs (substitui Raised/Units/Houses/Distributed + strip do prazo;
          captado/units/distribuído em detalhe moram na aba Investidores) */}
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {(
          [
            {
              label: "NAV / unit",
              hero: true,
              value: navR.navPerUnit != null ? formatMoney(navR.navPerUnit, pool.currency) : "—",
              up: navR.navPerUnit != null && navR.endPerUnit != null && navR.endPerUnit > navR.navPerUnit,
              hint: `NAV ${fmtCompact(navR.nav)} · fim ${
                navR.endPerUnit != null ? formatMoney(navR.endPerUnit, pool.currency) : "—"
              }`,
            },
            {
              label: "TIR viva",
              hero: true,
              value: live.irr != null ? `${(live.irr * 100).toFixed(1)}%` : "—",
              up: false,
              hint: planIrr != null ? `plano ${(planIrr * 100).toFixed(1)}%` : "XIRR real + plano",
            },
            {
              label: "TVPI · DPI",
              hero: false,
              value: `${tvpi != null ? `${tvpi.toFixed(2)}×` : "—"} · ${dpi != null ? `${dpi.toFixed(2)}×` : "—"}`,
              up: false,
              hint: planMultiple != null ? `MOIC plano ${planMultiple.toFixed(2)}×` : "curva J",
            },
            {
              label: "Captado",
              hero: false,
              value: pctRaised != null ? `${pctRaised}%` : fmtCompact(raisedN),
              up: false,
              hint:
                targetN != null
                  ? `${fmtCompact(raisedN)} de ${fmtCompact(targetN)}`
                  : `${table.totalUnits.toFixed(0)} units · sem target`,
            },
            {
              label: "Obra",
              hero: false,
              value: `${housesStarted}/${pool.houses.length}`,
              up: false,
              hint: `iniciadas · ${sold} vendida${sold === 1 ? "" : "s"}`,
            },
            {
              label: "Próx. distribuição",
              hero: false,
              value: risk.next?.date ? mesAno(risk.next.date) : "—",
              up: false,
              hint: risk.next
                ? `≈ ${fmtCompact(risk.next.total)} · ${risk.next.addr}`
                : Number(distributed) > 0
                  ? `distribuído ${fmtCompact(Number(distributed))}`
                  : "sem vendas no baseline",
            },
          ] as Array<{ label: string; hero: boolean; value: string; up: boolean; hint: string }>
        ).map((k) => (
          <div
            key={k.label}
            className={`rounded-xl border px-3 py-2 ${
              k.hero ? "border-[#1f3a5f]/25 bg-slate-50" : "border-slate-200 bg-white"
            }`}
          >
            <div className="text-[9.5px] uppercase tracking-wider text-slate-400">{k.label}</div>
            <div className="text-[15px] font-extrabold tabular-nums text-slate-900">
              {k.value}
              {k.up && <span className="ml-1 text-emerald-600">⤴</span>}
            </div>
            <div className="text-[9.5px] text-slate-400">{k.hint}</div>
          </div>
        ))}
      </div>

      <PoolTabsNav poolId={pool.id} active={tab} />

      {/* Overview (layout novo 18/07, mock aprovado): stepper fino + badges + grid 2x2 de
          cards compactos com "ver detalhe" — o painel completo mora na aba dele. Regra
          permanente: métrica nova (Fase 2+) = card compacto com drill, nunca painel inteiro. */}
      {tab === "overview" && (
        <div className="space-y-3">
          <PoolStatusStepper status={pool.status} subtitles={stepSubtitles} />
          <div className="flex flex-wrap items-center gap-1.5">
            {pendencias.map((p) => (
              <Link
                key={p.text}
                href={p.href}
                className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800 hover:bg-amber-200"
              >
                &#9888; {p.text}
              </Link>
            ))}
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-500">
              {formaPagamento}
            </span>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {/* Caixa & aporte — resumo; despesas + ledger completos em Investidores */}
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#1f3a5f]">
                  Caixa &amp; aporte
                </h2>
                <Link
                  href={`/pools/${pool.id}?tab=investors&sub=ledger`}
                  className="text-[10.5px] text-slate-400 hover:text-slate-600"
                >
                  ver detalhe &rarr; Investidores
                </Link>
              </div>
              <div className="space-y-0.5 text-[11.5px] text-slate-600">
                <div className="flex justify-between">
                  <span>Aportado</span>
                  <b className="tabular-nums">{formatMoney(raisedN, pool.currency)}</b>
                </div>
                <div className="flex justify-between">
                  <span>&minus; gasto nas casas</span>
                  <b className="tabular-nums text-amber-700">&minus;{formatMoney(spentOnHouses, pool.currency)}</b>
                </div>
                {Number(receivedFromSales) > 0 && (
                  <div className="flex justify-between">
                    <span>+ recebido das vendas</span>
                    <b className="tabular-nums text-emerald-700">{formatMoney(receivedFromSales, pool.currency)}</b>
                  </div>
                )}
                {Number(expensesPaid) > 0 && (
                  <div className="flex justify-between">
                    <span>&minus; despesas pagas</span>
                    <b className="tabular-nums">&minus;{formatMoney(expensesPaid, pool.currency)}</b>
                  </div>
                )}
                {Number(distributed) > 0 && (
                  <div className="flex justify-between">
                    <span>&minus; distribuído</span>
                    <b className="tabular-nums">&minus;{formatMoney(distributed, pool.currency)}</b>
                  </div>
                )}
                <div className="flex justify-between border-t border-dashed border-slate-200 pt-1 font-bold text-slate-800">
                  <span>Disponível hoje{Number(expensesProvisioned) > 0 ? " (livre de provisões)" : ""}</span>
                  <b className="tabular-nums">{formatMoney(freeToReturn, pool.currency)}</b>
                </div>
              </div>
              {shortfall != null && shortfall > 0 && (
                aporteLiquido != null && aporteLiquido <= 0.01 ? (
                  <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-[11px] text-emerald-700">
                    &#10003; Sem aporte adicional previsto — os loans cobrem a captação que falta
                  </div>
                ) : (
                  <div className="mt-2 flex justify-between rounded-lg border border-amber-200 bg-amber-50/60 px-2.5 py-1.5 text-[11.5px] font-bold text-amber-800">
                    <span>Aporte estimado (líq. dos loans)</span>
                    <span className="tabular-nums">{formatMoney(aporteLiquido ?? shortfall, pool.currency)}</span>
                  </div>
                )
              )}
              {shortfall != null && shortfall > 0 && (
                <p className="mt-1 text-[10.5px] text-slate-400">
                  falta captar {fmtCompact(shortfall)} {loanSurplus >= 0 ? "\u2212 sobra" : "+ falta"} dos loans{" "}
                  {fmtCompact(Math.abs(loanSurplus))} &middot;{" "}
                  <Link href={`/pools/${pool.id}/loan?stab=houses`} className="underline hover:text-slate-600">
                    ver a conta &rarr;
                  </Link>
                </p>
              )}
              {lowCash && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                  Caixa em <b>{((availableN / raisedN) * 100).toFixed(1)}% do captado</b> — próximos
                  desembolsos dependem de aportes ou capital call.
                </p>
              )}
            </section>

            {/* Marcação & retorno — resumo da cascata; regua tem NAV/unit, TIR, TVPI/DPI */}
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#1f3a5f]">
                  Marcação &amp; retorno
                </h2>
                {sim && (
                  <Link
                    href={`/pools/simulator/${sim.id}`}
                    className="text-[10.5px] text-slate-400 hover:text-slate-600"
                  >
                    ver simulação &rarr;
                  </Link>
                )}
              </div>
              <div className="space-y-0.5 text-[11.5px] text-slate-600">
                <div className="flex justify-between">
                  <span>Caixa disponível</span>
                  <b className="tabular-nums">{formatMoney(navR.cash, pool.currency)}</b>
                </div>
                <div className="flex justify-between">
                  <span>+ custo incorrido nas casas (equity + banco)</span>
                  <b className="tabular-nums">{formatMoney(navR.incurred, pool.currency)}</b>
                </div>
                <div className="flex justify-between">
                  <span>+ valorização pela obra</span>
                  <b className="tabular-nums text-emerald-700">{formatMoney(navR.uplift, pool.currency)}</b>
                </div>
                <div className="flex justify-between">
                  <span>&minus; dívida dos loans</span>
                  <b className="tabular-nums text-red-700">&minus;{formatMoney(navR.debt, pool.currency)}</b>
                </div>
                <div className="flex justify-between border-t border-dashed border-slate-200 pt-1 font-bold text-slate-800">
                  <span>= NAV &rarr; por unit</span>
                  <b className="tabular-nums">
                    {formatMoney(navR.nav, pool.currency)}
                    {navR.navPerUnit != null ? ` \u2192 ${formatMoney(navR.navPerUnit, pool.currency)}` : ""}
                  </b>
                </div>
              </div>
              <p className="mt-1.5 text-[10.5px] text-slate-400">
                curva J: par {formatMoney(unitPar, pool.currency)} &rarr; hoje{" "}
                {navR.navPerUnit != null ? formatMoney(navR.navPerUnit, pool.currency) : "\u2014"} &rarr; fim{" "}
                {navR.endPerUnit != null ? formatMoney(navR.endPerUnit, pool.currency) : "\u2014"}
                {navR.navPerUnit != null && navR.endPerUnit != null && navR.endPerUnit > navR.navPerUnit
                  ? " \u2934"
                  : ""}
                {planIrr != null || planMultiple != null
                  ? ` \u00b7 plano: TIR ${planIrr != null ? `${(planIrr * 100).toFixed(1)}%` : "\u2014"} \u00b7 MOIC ${
                      planMultiple != null ? `${planMultiple.toFixed(2)}\u00d7` : "\u2014"
                    }`
                  : ""}
              </p>
            </section>

            {/* Risco & caixa futuro (Fase 2, mock aprovado 18/07) — resumo; painel na aba */}
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#1f3a5f]">
                  Risco &amp; caixa futuro
                </h2>
                <Link
                  href={`/pools/${pool.id}/provision`}
                  className="text-[10.5px] text-slate-400 hover:text-slate-600"
                >
                  ver painel &rarr; Provisão &amp; risco
                </Link>
              </div>
              <div className="space-y-0.5 text-[11.5px] text-slate-600">
                <div className="flex justify-between">
                  <span>Runway do caixa</span>
                  <b
                    className={`tabular-nums ${
                      risk.runwayMonths == null
                        ? "text-slate-400"
                        : risk.runwayMonths < 2
                          ? "text-red-700"
                          : risk.runwayMonths < 4
                            ? "text-amber-700"
                            : "text-emerald-700"
                    }`}
                  >
                    {risk.runwayMonths == null
                      ? "sem juros correndo"
                      : `${risk.runwayMonths.toFixed(1).replace(".", ",")} mês${risk.runwayMonths >= 2 ? "es" : ""}${risk.runwayMonths < 2 ? " ⚠" : ""}`}
                  </b>
                </div>
                <div className="flex justify-between">
                  <span>Juros/mês hoje ({risk.loans.filter((l) => !l.quitado).length} loans, sem reserve)</span>
                  <b className="tabular-nums">&asymp; {formatMoney(risk.monthlyToday, pool.currency)}</b>
                </div>
                <div className="flex justify-between">
                  <span>Breakeven — vendas podem cair</span>
                  <b className="tabular-nums text-emerald-700">
                    {risk.breakevenPct != null ? `≈ ${risk.breakevenPct.toFixed(1)}%` : "—"}
                  </b>
                </div>
                <div className="flex justify-between">
                  <span>Stress combinado (&minus;10% e +6m)</span>
                  {(() => {
                    const worst = risk.scenarios[risk.scenarios.length - 1];
                    return (
                      <b className={`tabular-nums ${worst.profit < 0 ? "text-red-700" : "text-slate-700"}`}>
                        &asymp; {worst.profit < 0 ? "−" : ""}
                        {fmtCompact(Math.abs(worst.profit))}
                      </b>
                    );
                  })()}
                </div>
                <div className="flex justify-between border-t border-dashed border-slate-200 pt-1 font-bold text-slate-800">
                  <span>Próx. distribuição (baseline)</span>
                  <b className="tabular-nums">
                    {risk.next?.date ? `${mesAno(risk.next.date)} · ≈ ${fmtCompact(risk.next.total)}` : "—"}
                  </b>
                </div>
              </div>
              {risk.runwayMonths != null && risk.runwayMonths < 1 && (
                <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-[11px] text-red-700">
                  &#9888; caixa {fmtCompact(risk.freeCash)} não cobre o próximo ciclo de juros (&asymp;
                  {formatMoney(risk.monthlyToday, pool.currency)}) — capital call sugerido:{" "}
                  {risk.callMin90d != null ? `${fmtCompact(risk.callMin90d)} (90d)` : ""}
                  {risk.callSufficiency != null ? ` ou ${fmtCompact(risk.callSufficiency)} (suficiência)` : ""}
                </p>
              )}
            </section>

            {/* Atividade — últimos 6 eventos; feed completo na rota própria */}
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#1f3a5f]">
                  Atividade
                </h2>
                <Link
                  href={`/pools/${pool.id}/activity`}
                  className="text-[10.5px] text-slate-400 hover:text-slate-600"
                >
                  ver todas ({feed.total}) &rarr;
                </Link>
              </div>
              {feed.events.length === 0 ? (
                <p className="text-[11.5px] text-slate-400">sem eventos registrados ainda</p>
              ) : (
                <div className="space-y-0.5">
                  {feed.events.slice(0, 6).map((e, i) => (
                    <div key={`${e.date.toISOString()}-${i}`} className="flex items-baseline gap-2 text-[11.5px] text-slate-600">
                      <span className="w-11 shrink-0 tabular-nums text-[10px] text-slate-400">
                        {`${String(e.date.getUTCMonth() + 1).padStart(2, "0")}/${String(e.date.getUTCDate()).padStart(2, "0")}`}
                      </span>
                      <span className="shrink-0">{e.icon}</span>
                      <span className="truncate">{e.text}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Casas — progresso por status + alertas de mercado; board + tabela na aba Casas */}
            <section className="rounded-xl border border-slate-200 bg-white px-4 py-3">
              <div className="mb-2 flex items-baseline justify-between">
                <h2 className="text-[10px] font-semibold uppercase tracking-wider text-[#1f3a5f]">
                  Casas
                </h2>
                <Link
                  href={`/pools/${pool.id}?tab=houses`}
                  className="text-[10.5px] text-slate-400 hover:text-slate-600"
                >
                  board + mercado &rarr; Casas
                </Link>
              </div>
              <div className="space-y-1">
                {statusCounts
                  .filter(({ status, count }) => count > 0 || status === "SOLD")
                  .map(({ status, count }) => (
                    <Link
                      key={status}
                      href={`/pools/${pool.id}?tab=houses&status=${status}`}
                      className="grid grid-cols-[110px_1fr_24px] items-center gap-2 rounded text-[11px] text-slate-600 hover:bg-slate-50"
                    >
                      <span>{HOUSE_STATUS_LABEL[status]}</span>
                      <div className="h-2 rounded-full bg-slate-100">
                        {count > 0 && (
                          <div
                            className={`h-full rounded-full ${
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
                      <b className="text-right tabular-nums text-slate-700">{count}</b>
                    </Link>
                  ))}
              </div>
              {marketAlerts.length > 0 && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                  &#9888; mercado:{" "}
                  {marketAlerts
                    .slice(0, 3)
                    .map((r) => `${r.addr} \u2014 ${r.verdict.label.replace(/^[\u26a0\u25b3\u2713] /u, "")}`)
                    .join(" \u00b7 ")}
                  {marketAlerts.length > 3 ? ` \u00b7 +${marketAlerts.length - 3}` : ""} &middot;{" "}
                  <Link href={`/pools/${pool.id}?tab=houses&view=market`} className="underline">
                    ver tabela &rarr;
                  </Link>
                </p>
              )}
              {statusLag && (
                <p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-800">
                  Casas em Planned com gasto de {fmtCompact(Number(spentOnHouses))} — status
                  atrasados; atualize pelo stepper na ficha de cada casa.
                </p>
              )}
              <p className="mt-1.5 text-[10.5px] text-slate-400">
                lucro previsto {formatMoney(houseTotals.plannedProfit, pool.currency)} &middot; descoberto do
                envelope:{" "}
                {envelopeShortRows.length === 0 ? (
                  "nenhum"
                ) : (
                  <Link href={`/pools/${pool.id}/loan?stab=houses`} className="text-amber-700 underline">
                    {envelopeShortRows.length} casa{envelopeShortRows.length === 1 ? "" : "s"} &rarr;
                  </Link>
                )}
              </p>
            </section>
          </div>
        </div>
      )}

      {/* Casas (mock UX 4/6 + layout novo 18/07): toggle Board | Mercado — a tabela
          lucro × mercado saiu do Overview e virou a segunda visão da aba */}
      {tab === "houses" && (
        <div className="space-y-4">
          <div className="flex gap-1.5">
            {(
              [
                ["board", "🏘 Board"],
                ["market", "📈 Mercado"],
              ] as const
            ).map(([key, label]) => (
              <Link
                key={key}
                href={`/pools/${pool.id}?tab=houses${key === "market" ? "&view=market" : ""}`}
                className={`rounded-full border px-3.5 py-1 text-xs font-semibold transition ${
                  housesView === key
                    ? "border-[#1f3a5f] bg-[#1f3a5f] text-white"
                    : "border-slate-300 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {label}
              </Link>
            ))}
          </div>
          {housesView === "board" && (
            <PoolHousesTab poolId={pool.id} rows={houseRows} initialStatus={rawStatus ?? null} />
          )}
          {housesView === "market" && (
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-3">
              <h2 className="text-base font-medium text-slate-800">Lucro por casa × mercado</h2>
              <p className="text-xs text-slate-400">
                Venda planejada comparada com a distribuição de casas novas VENDIDAS do submercado
                (ATTOM, feed semanal). &quot;Acima do p90/teto&quot; pede justificativa (sqft,
                acabamento) ou revisão de preço.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-slate-400">Casa</th>
                    <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-slate-400">Submercado</th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-slate-400">Custo total</th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-slate-400">Venda plan.</th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-slate-400">Mercado (mediana NC · DOM)</th>
                    <th className="px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-slate-400">Margem</th>
                    <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-slate-400">Farol</th>
                  </tr>
                </thead>
                <tbody>
                  {marketRows.map((r) => (
                    <tr key={r.id} className={`border-b border-slate-50 ${r.sold ? "opacity-50" : ""}`}>
                      <td className="px-3 py-2 text-sm">
                        <span className="font-semibold text-slate-700">{r.addr}</span>
                        <span className="ml-1.5 text-[10.5px] text-slate-400">{r.model}</span>
                        {r.sold && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 text-[9.5px] text-slate-500">vendida</span>}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">{r.stats?.name ?? r.loc}</td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-slate-700">
                        {r.cost > 0 ? formatMoney(r.cost, pool.currency) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-sm tabular-nums text-slate-700">
                        {r.sale != null ? formatMoney(r.sale, pool.currency) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-500">
                        {r.stats
                          ? `${formatMoney(r.stats.median, pool.currency)} · ${r.stats.dom}d${
                              r.verdict.tone === "red"
                                ? ` (máx obs. ${formatMoney(r.stats.max, pool.currency)})`
                                : r.verdict.tone === "amber" && r.sale != null && r.sale >= r.stats.p90
                                  ? ` (p90 ${formatMoney(r.stats.p90, pool.currency)})`
                                  : ""
                            }`
                          : "sem amostra NC"}
                      </td>
                      <td className={`px-3 py-2 text-right text-sm font-bold tabular-nums ${(r.margin ?? 0) >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                        {r.margin != null ? `+${formatMoney(r.margin, pool.currency)}` : "—"}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        <span
                          className={
                            r.verdict.tone === "green"
                              ? "font-semibold text-emerald-700"
                              : r.verdict.tone === "amber"
                                ? "font-semibold text-amber-700"
                                : "font-semibold text-red-700"
                          }
                        >
                          {r.verdict.label}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} className="px-3 py-2.5 text-sm font-bold text-slate-800">
                      Lucro previsto do pool
                    </td>
                    <td className="border-t-2 border-slate-200 px-3 py-2 text-right text-sm font-bold tabular-nums text-emerald-700">
                      +{formatMoney(marketRows.reduce((s, r) => s + (r.margin ?? 0), 0), pool.currency)}
                    </td>
                    <td className="border-t-2 border-slate-200" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
          )}
        </div>
      )}

      {/* Investidores (mock UX 2/6 + layout novo 18/07): absorve Capital ledger e
          Distribuições como sub-abas; despesas do pool moram no Ledger */}
      {tab === "investors" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {INVESTOR_SUBS.map((key) => (
              <Link
                key={key}
                href={`/pools/${pool.id}?tab=investors&sub=${key}`}
                className={`rounded-full border px-3.5 py-1 text-xs font-semibold transition ${
                  invSub === key
                    ? "border-[#1f3a5f] bg-[#1f3a5f] text-white"
                    : "border-slate-300 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {t(`sub.${key}` as "sub.members")}
              </Link>
            ))}
            {/* Fase 4: portfólio consolidado por entidade — a futura home do portal */}
            <Link
              href="/pools/investors"
              className="ml-auto text-xs font-semibold text-[#1f3a5f] hover:underline"
            >
              {t("iv.link")}
            </Link>
          </div>

          {invSub === "members" && (
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
          suggestedCallAmount={
            risk.callSufficiency != null
              ? String(Math.round(risk.callSufficiency))
              : risk.callMin90d != null
                ? String(Math.ceil(risk.callMin90d))
                : null
          }
          distOptions={distRows.map((d) => ({
            id: d.id,
            label: `${d.date} · ${d.kind === "PROFIT" ? "lucro" : "capital"} · ${formatMoney(d.total, pool.currency)}`,
          }))}
          subscriptions={subscriptionRows}
          subscribeOrigin={subscribeOrigin}
        />
          )}

          {/* Capital ledger (mock UX 6/6): filtros, acumulado, transfer pareada, CSV */}
          {invSub === "ledger" && (
            <>
              <PoolLedgerTab
                poolId={pool.id}
                rows={ledgerRows}
                members={memberOptions}
                raised={Number(raised)}
                totalUnits={Number(table.totalUnits)}
              />
              {/* Despesas do pool (saíram do Overview no layout novo): pagas × provisionadas */}
              <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
                  Despesas do pool
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Saem do caixa antes do lucro — provisionadas seguram a devolução aos investidores.
                </p>
                {pool.expenses.length > 0 ? (
                  <div className="mt-2 divide-y divide-slate-50 border-t border-slate-100">
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
                ) : (
                  <p className="mt-2 text-sm text-slate-400">Nenhuma despesa lançada.</p>
                )}
                <details className="mt-3">
                  <summary className="inline-block cursor-pointer rounded-lg border border-slate-300 px-3.5 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    + Despesa
                  </summary>
                  <div className="mt-3">
                    <AddPoolExpenseForm poolId={pool.id} />
                  </div>
                </details>
              </section>
            </>
          )}

          {/* Distribuições (mock UX 6/6): resumo, preview do rateio, linha expansível */}
          {invSub === "distributions" && (
            <PoolDistributionsTab
              poolId={pool.id}
              rows={distRows}
              houses={pool.houses.map((h) => ({ id: h.id, address: h.address }))}
              members={distMembers}
            />
          )}

          {/* Data room (Fase 3, mock aprovado 18/07): docs agrupados + taxas & partes */}
          {invSub === "dataroom" && (
            <PoolDataRoom
              poolId={pool.id}
              lang={lang}
              dateLocale={dateLocale}
              currency={pool.currency}
              loanDocs={pool.loans.flatMap((l) =>
                l.documents.map((d) => ({
                  id: d.id,
                  fileName: d.fileName,
                  kind: d.kind as string,
                  createdAt: d.createdAt,
                  bank: l.bankProfile?.name?.split(" ")[0] ?? "—",
                  portalVisible: d.portalVisible,
                })),
              )}
              poolDocs={pool.documents.map((d) => ({
                id: d.id,
                docType: d.docType,
                fileName: d.fileName,
                createdAt: d.createdAt,
                portalVisible: d.portalVisible,
                hasPdf: d.pdfSize != null,
                memberName: d.memberId ? (memberById.get(d.memberId) ?? null) : null,
                reportMonth: d.reportMonth,
              }))}
              memberOptions={memberOptions.map((m) => ({ id: m.id, name: m.name }))}
              fees={{
                perfPct: pool.profitSharePct != null ? Number(pool.profitSharePct) : null,
                perfTiming: pool.profitShareTiming,
                perfFeeTotal: simKpis?.perfFeeTotal ?? null,
                contractorFeeTotal: simKpis?.contractorFeeTotal ?? null,
                promoteTotal: simKpis?.promoteTotal ?? null,
                vehicleCostTotal: simKpis?.vehicleCostTotal ?? null,
                builderName: "4U Custom Homes Corp",
                housesCount: pool.houses.length,
                hasNote: pool.noteLoan != null,
                banks: pool.loans
                  .map((l) => l.bankProfile?.name?.split(" ")[0])
                  .filter((b): b is string => !!b),
              }}
            />
          )}
        </div>
      )}
    </div>
  );
}
