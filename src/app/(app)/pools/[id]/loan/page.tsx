import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { buildStatement, ENTRY_TYPE_LABEL } from "@/lib/pools/loan-statement";
import {
  deleteLoanEntry,
  deletePoolLoan,
  generatePayoffFromHouse,
  toggleLoanEntryReconciled,
} from "@/lib/actions/pool-loan";
import { AddLoanEntryForm, PoolLoanTermsForm } from "@/components/pool-loan-forms";
import { PoolLoanTermsView } from "@/components/pool-loan-terms-view";
import { PoolLoanHousesTab, type LoanHouseRow } from "@/components/pool-loan-houses";
import {
  LoanChargesPanel,
  LoanInterestPanel,
  type ChargeCandidate,
  type InterestRow,
} from "@/components/pool-loan-interest-panels";
import { computeLoanInterest } from "@/lib/pools/loan-interest";
import { DrawHousesPanel, type HouseAvailability } from "@/components/pool-draw-houses";
import { DrawList, type DrawRow } from "@/components/pool-draw-list";
import { byAddressNumber } from "@/lib/pools/math";
import { PoolLoanDocs } from "@/components/pool-loan-docs";
import type { LoanDocProposalItem } from "@/lib/pools/loan-doc-apply";
import { PoolTabsNav } from "@/components/pool-tabs";
import { LoanMonthFilter } from "@/components/loan-month-filter";

export const dynamic = "force-dynamic";
// lote de documentos com leitura AI (classificação + extração em paralelo) pode demorar
export const maxDuration = 300;

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-1.5 text-sm text-slate-600";
const tdRight = "px-3 py-1.5 text-right text-sm tabular-nums text-slate-700";

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export default async function PoolLoanPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; loan?: string; stab?: string }>;
}) {
  const { id } = await params;
  const { month: rawMonth, loan: rawLoan, stab: rawStab } = await searchParams;
  const pool = await prisma.investmentPool.findUnique({
    where: { id },
    include: {
      houses: { orderBy: { createdAt: "asc" }, include: { catalogModel: true, catalogLocation: true } },
      loans: {
        orderBy: { createdAt: "asc" },
        include: {
          bankProfile: true,
          entries: { include: { house: true }, orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
          documents: {
            orderBy: { createdAt: "desc" },
            select: {
              id: true,
              kind: true,
              fileName: true,
              pdfSize: true,
              summary: true,
              extracted: true,
              proposal: true,
              appliedSummary: true,
              appliedAt: true,
              createdAt: true,
            },
          },
        },
      },
      expenses: { select: { amount: true } },
    },
  });
  if (!pool) notFound();
  // seletor: ?loan=<id> | "new" (formulário vazio p/ criar) | default = primeiro loan
  const creatingNew = rawLoan === "new" || pool.loans.length === 0;
  const loan = creatingNew ? null : (pool.loans.find((l) => l.id === rawLoan) ?? pool.loans[0]);
  // sub-abas internas (17/07): Statement (default) | Documentos | Termos | Casas | Draws
  const stab = ["docs", "terms", "houses", "draws"].includes(rawStab ?? "") ? rawStab! : "statement";
  const banks = await prisma.bankProfile.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });
  const loanLabel = (l: (typeof pool.loans)[number]) =>
    `${l.bankProfile?.name ?? "Banco a definir"}${l.loanNumber ? ` · ${l.loanNumber}` : ""}`;

  const apr =
    loan?.aprPct != null
      ? Number(loan.aprPct)
      : loan?.bankProfile
        ? loan.bankProfile.rateType === "FIXED"
          ? Number(loan.bankProfile.aprPct)
          : Number(loan.bankProfile.indexPct) + Number(loan.bankProfile.spreadPct)
        : null;

  const stmt = loan
    ? buildStatement(
        // draws PENDENTES (aguardando o banco) ficam fora do saldo até a liberação
        loan.entries.filter((e) => !e.pending).map((e) => ({
          id: e.id,
          type: e.type,
          date: e.date,
          amount: Number(e.amount),
          houseLabel: e.house?.address ?? null,
          memo: e.memo,
          reconciled: e.reconciled,
          createdAt: e.createdAt,
        })),
        apr,
      )
    : null;

  // meses do filtro: do primeiro lançamento até o mês corrente (auto-incremental)
  const monthKey = (d: Date) => d.toISOString().slice(0, 7);
  const months: string[] = [];
  if (stmt && stmt.rows.length > 0) {
    const cursor = new Date(stmt.rows[0].date);
    cursor.setUTCDate(1);
    const end = new Date();
    while (monthKey(cursor) <= monthKey(end)) {
      months.push(monthKey(cursor));
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const month = rawMonth && (rawMonth === "all" || months.includes(rawMonth)) ? rawMonth : "all";
  const visibleRows = stmt
    ? month === "all"
      ? stmt.rows
      : stmt.rows.filter((r) => monthKey(r.date) === month)
    : [];

  // casas vendidas com payoff que ainda não foi lançado no statement — só as DESTE loan
  const payoffLaunched = new Set(
    loan?.entries.filter((e) => e.type === "PAYOFF" && e.houseId).map((e) => e.houseId) ?? [],
  );
  const pendingPayoffs = loan
    ? pool.houses.filter(
        (h) =>
          (h.loanId === loan.id || (h.loanId == null && pool.loans.length === 1)) &&
          h.payoffAmount != null &&
          h.saleDate != null &&
          !payoffLaunched.has(h.id),
      )
    : [];

  // ── aba TERMOS (travada) — dados do loan + condições do perfil do banco + LOI ──
  const fmtBr = (iso: string | null) =>
    iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : null;
  const num = (v: unknown) => String(Number(v ?? 0));
  const paidOff = stmt != null && stmt.totalPayoffs > 0 && stmt.balance <= 0.01;
  const todayIso = new Date().toISOString().slice(0, 10);
  const dayMs = 24 * 60 * 60 * 1000;
  const loiDoc = loan?.documents.find((d) => d.kind === "LOI" && d.extracted != null);
  const loiEx = (loiDoc?.extracted ?? null) as { loiDate?: string; prepaymentPenalty?: string } | null;
  const customFees =
    stab === "terms" && loan?.bankProfileId
      ? await prisma.bankCustomFee.findMany({
          where: { bankProfileId: loan.bankProfileId },
          orderBy: { name: "asc" },
        })
      : [];
  const contractDaysOf = (l: NonNullable<typeof loan>) => {
    if (!l.firstContactDate) return null;
    const end = l.closingDate ? fmtDate(l.closingDate) : todayIso;
    const d = Math.round((new Date(end).getTime() - new Date(fmtDate(l.firstContactDate)).getTime()) / dayMs);
    return l.closingDate ? `contratado em ${d}d` : `${d}d em curso ⏱`;
  };
  const bp = loan?.bankProfile ?? null;
  const termsBank = bp
    ? {
        rateText:
          bp.rateType === "FIXED"
            ? "fixa"
            : bp.rateType === "PRIME_SPREAD"
              ? `Prime + ${num(bp.spreadPct)}%`
              : `SOFR + ${num(bp.spreadPct)}%`,
        basisText:
          bp.interestBasis === "DRAWN" ? "sobre o sacado (non-Dutch)" : "sobre o comprometido (Dutch)",
        termMonths: bp.termMonths,
        extensionMonths: bp.extensionMonths,
        ltcBuildPct: num(bp.ltcBuildPct),
        ltvPct: num(bp.ltvPct),
        originationPct: num(bp.originationPct),
        brokerPct: num(bp.brokerPct),
        processingFee: num(bp.processingFee),
        appraisalFee: num(bp.appraisalFee),
        legalFee: num(bp.legalFee),
        budgetReviewFee: num(bp.budgetReviewFee),
        inspectionFeePerDraw: num(bp.inspectionFeePerDraw),
        feesFinanced: bp.feesFinanced,
        reserveText: bp.hasInterestReserve
          ? `financiada (${num(bp.reserveMonths)}m${bp.reserveInEnvelope ? ", no envelope" : ""})`
          : "liquidez exigida (não financiada)",
        reserveMonths: num(bp.reserveMonths),
        customFees: customFees.map((f) => ({ name: f.name, amount: num(f.amount) })),
      }
    : null;

  // ── aba CASAS — só as casas DESTE loan, com o loan da casa aberto no clique ──
  const entriesOfHouse = (houseId: string) =>
    loan?.entries.filter((e) => e.houseId === houseId) ?? [];
  const linkedHouses = loan ? pool.houses.filter((h) => h.loanId === loan.id) : [];
  // Suficiência do financiamento (17/07, fórmula do Stefan): o closing consome parte do
  // financiado → disponível p/ obra = drawable − closing rateado. Necessário do banco =
  // obra estimada − aporte próprio além do lote. Falta > 0 = aporte dos sócios.
  const loanConsumed = loan
    ? loan.entries
        .filter((e) => !e.pending && ["CLOSING_FEE", "OTHER", "RESERVE", "DRAW_FEE"].includes(e.type))
        .reduce((s, e) => s + Number(e.amount), 0)
    : 0;
  const loanDrawableTotal = linkedHouses.reduce((s, h) => s + Number(h.bankLoanAmount ?? 0), 0);
  const suffOf = (h: (typeof pool.houses)[number]) => {
    const drawable = h.bankLoanAmount != null ? Number(h.bankLoanAmount) : null;
    const obra = h.plannedBuildCost != null ? Number(h.plannedBuildCost) : null;
    if (drawable == null || obra == null) return null;
    const lote = Number(h.actualLotCost ?? h.plannedLotCost ?? 0);
    const aporte = Number(h.ownCapital ?? 0);
    const equityObra = Math.max(0, aporte - lote); // aporte próprio além do lote
    const necessario = Math.max(0, obra - equityObra);
    const consumido = loanDrawableTotal > 0 ? loanConsumed * (drawable / loanDrawableTotal) : 0;
    const disponivel = drawable - consumido;
    const falta = necessario - disponivel;
    const f = (v: number) => formatMoney(v, pool.currency);
    return {
      obraFmt: f(obra),
      equityObraFmt: equityObra > 0 ? f(equityObra) : null,
      necessarioFmt: f(necessario),
      consumidoFmt: consumido > 0.01 ? f(consumido) : null,
      disponivelFmt: f(disponivel),
      faltaFmt: f(Math.abs(falta)),
      falta: falta > 0.01,
      folgaOk: falta <= 0.01,
    };
  };
  const houseRows: LoanHouseRow[] = linkedHouses.map((h) => {
    const es = entriesOfHouse(h.id);
    const solid = es.filter((e) => !e.pending);
    const sum = (types: string[]) =>
      solid.filter((e) => types.includes(e.type)).reduce((s, e) => s + Number(e.amount), 0);
    const drawable = h.bankLoanAmount != null ? Number(h.bankLoanAmount) : null;
    const drawn = sum(["DRAW"]);
    const interestPaid = Math.abs(sum(["INTEREST_PAYMENT"]));
    const payoff = Math.abs(sum(["PAYOFF"]));
    const parts = h.address.split(",");
    return {
      id: h.id,
      address: parts[0],
      sub: parts.slice(1).join(",").trim() || null,
      statusLabel: h.status.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()),
      drawableRaw: drawable != null ? String(drawable) : "",
      suff: suffOf(h),
      drawableFmt: drawable != null ? formatMoney(drawable, pool.currency) : null,
      drawnFmt: drawn > 0 ? formatMoney(drawn, pool.currency) : null,
      availableFmt: drawable != null ? formatMoney(Math.max(0, drawable - drawn), pool.currency) : null,
      interestFmt: interestPaid > 0 ? formatMoney(interestPaid, pool.currency) : null,
      payoffFmt: payoff > 0 ? formatMoney(payoff, pool.currency) : null,
      pct: drawable != null && drawable > 0 ? Math.round((drawn / drawable) * 100) : null,
      entries: es.map((e) => ({
        id: e.id,
        date: fmtBr(fmtDate(e.date))!,
        typeLabel: ENTRY_TYPE_LABEL[e.type] ?? e.type,
        memo: e.memo,
        amountFmt: formatMoney(Number(e.amount), pool.currency),
        negative: Number(e.amount) < 0,
        pending: e.pending,
      })),
    };
  });
  const unlinkedHouses = pool.houses
    .filter((h) => h.loanId == null)
    .map((h) => ({
      id: h.id,
      address: h.address,
      drawableFmt: h.bankLoanAmount != null ? formatMoney(Number(h.bankLoanAmount), pool.currency) : null,
    }));
  // ── Cobranças do contrato (mock aprovado 17/07): fees + crédito do closing achados na
  // leitura dos docs e ausentes do statement. O funded do banco costuma EMBUTIR essas
  // linhas — lançá-las COMPÕE o saldo (nunca duplicar com um draw já lançado do mesmo valor).
  type ExLite = {
    feesAtClosing?: Array<{ name: string; amount: number; financed: boolean }>;
    cashToBorrower?: number;
    closingDate?: string;
    docDate?: string;
    endingBalance?: number;
  };
  const chargeCandidates: ChargeCandidate[] = [];
  let fundedNote: string | null = null;
  if (loan) {
    const launched = [
      ...loan.entries
        .filter((e) => ["CLOSING_FEE", "DRAW_FEE", "OTHER", "RESERVE", "DRAW"].includes(e.type))
        .map((e) => Number(e.amount)),
      ...pool.expenses.map((e) => Number(e.amount)),
    ];
    const near = (a: number) => launched.some((x) => Math.abs(Math.abs(x) - a) < 1);
    const seen = new Set<string>();
    for (const d of loan.documents.filter(
      (dd) => ["AGREEMENT", "NOTE", "SETTLEMENT"].includes(dd.kind) && dd.extracted != null,
    )) {
      const ex2 = d.extracted as ExLite;
      const date = ex2.closingDate?.trim() || ex2.docDate?.trim() || fmtDate(d.createdAt);
      (ex2.feesAtClosing ?? []).forEach((f, i) => {
        const dupKey = `${f.name.toLowerCase()}|${Math.round(f.amount)}`;
        if (f.amount <= 0 || near(f.amount) || seen.has(dupKey)) return;
        seen.add(dupKey);
        chargeCandidates.push({
          key: `${d.id}:${i}`,
          name: f.name,
          source: `«${d.fileName}»`,
          date,
          amountFmt: formatMoney(f.amount, pool.currency),
          amount: f.amount,
          target: f.financed ? "DEBT" : "EXPENSE",
        });
      });
      const cash = ex2.cashToBorrower ?? 0;
      if (cash > 0 && !near(cash) && !seen.has(`cash|${Math.round(cash)}`)) {
        seen.add(`cash|${Math.round(cash)}`);
        chargeCandidates.push({
          key: `${d.id}:cash`,
          name: "Crédito recebido no closing (cash to borrower)",
          source: `«${d.fileName}»`,
          date,
          amountFmt: formatMoney(cash, pool.currency),
          amount: cash,
          target: "CREDIT_IN",
        });
      }
      if (ex2.endingBalance && ex2.endingBalance > 0 && !fundedNote)
        fundedNote = `Referência do banco: saldo ${formatMoney(ex2.endingBalance, pool.currency)} («${d.fileName}»).`;
    }
  }

  // ── Juros período a período (mock aprovado 17/07) ──
  const interestView =
    loan && loan.closingDate
      ? computeLoanInterest({
          entries: loan.entries
            .filter((e) => !e.pending)
            .map((e) => ({ type: e.type, date: e.date, amount: Number(e.amount) })),
          aprPct: apr,
          closingDate: loan.closingDate,
          dueDay: loan.interestDueDay,
          graceDays: loan.graceDays,
          today: new Date(),
        })
      : null;
  const dayMs0 = 24 * 60 * 60 * 1000;
  const interestRows: InterestRow[] = (interestView?.periods ?? []).map((p) => ({
    label: p.label,
    baseFmt: p.baseEnd > 0 ? formatMoney(p.baseEnd, pool.currency) : null,
    expectedFmt: formatMoney(p.expected, pool.currency),
    chargedFmt: p.charged > 0 ? formatMoney(p.charged, pool.currency) : null,
    dueDate: `${p.dueDate.slice(8, 10)}/${p.dueDate.slice(5, 7)}/${p.dueDate.slice(2, 4)}`,
    dDays: Math.ceil((new Date(p.dueDate).getTime() - Date.now()) / dayMs0),
    status: p.status,
    owed: Math.max(0, p.owed),
  }));
  const interestRule = loan
    ? `Vencimento: dia ${loan.interestDueDay ?? 1} do mês seguinte${loan.graceDays ? ` · grace ${loan.graceDays} dias` : ""}${loan.lateFeePct ? ` · multa ${Number(loan.lateFeePct)}%` : ""} — ${loan.interestDueDay ? "lido do contrato (editável nos Termos)" : "padrão (a leitura do contrato preenche; editável nos Termos)"}. Esperado = accrual diário APR/360 sobre o saldo; cobrado vem do extrato do banco.`
    : "";

  // ── lembrete (17/07): loans ATIVOS sem interest reserve pagam juro mensal POR FORA —
  // um aviso por loan com o valor estimado (non-Dutch: saldo × APR/12; Dutch: comprometido)
  const interestReminders = pool.loans
    .map((l) => {
      const bank2 = l.bankProfile;
      if (!l.closingDate || !bank2 || bank2.hasInterestReserve) return null;
      const solid = l.entries.filter((e) => !e.pending);
      const balance = solid.reduce((s, e) => s + Number(e.amount), 0);
      const quitado = solid.some((e) => e.type === "PAYOFF") && balance <= 0.01;
      if (quitado) return null;
      const aprL =
        l.aprPct != null
          ? Number(l.aprPct)
          : bank2.rateType === "FIXED"
            ? Number(bank2.aprPct)
            : Number(bank2.indexPct) + Number(bank2.spreadPct);
      const dutch = bank2.interestBasis === "COMMITTED";
      const baseAmt = dutch ? Number(l.committed ?? 0) : balance;
      return {
        id: l.id,
        label: loanLabel(l),
        aprL,
        monthly: baseAmt > 0 ? (baseAmt * (aprL / 100)) / 12 : null,
        baseAmt,
        dutch,
        semLancamentos: !dutch && balance <= 0.01,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null);

  // ── aba DRAWS (mock aprovado 17/07): a gestão de draws mora DENTRO do loan — a tela
  // do menu é só dash. Portado de /pools/draws/[poolId] (aposentada).
  const drawEntries = loan ? loan.entries.filter((e) => e.type === "DRAW") : [];
  const drawsPendingCount = drawEntries.filter((e) => e.pending).length;
  const drawsCredited = drawEntries.filter((e) => !e.pending).reduce((s, e) => s + Number(e.amount), 0);
  const drawsAwaiting = drawEntries
    .filter((e) => e.pending)
    .reduce((s, e) => s + Number(e.requestedAmount ?? 0), 0);
  const drawsBudget = linkedHouses.reduce((s, h) => s + Number(h.bankLoanAmount ?? 0), 0);
  const drawAgg = new Map<string, { credited: number; pending: number }>();
  for (const e of drawEntries) {
    const k = e.houseId ?? "__none__";
    const cur = drawAgg.get(k) ?? { credited: 0, pending: 0 };
    if (e.pending) cur.pending += Number(e.requestedAmount ?? 0);
    else cur.credited += Number(e.amount);
    drawAgg.set(k, cur);
  }
  const drawHouses: HouseAvailability[] = [...linkedHouses].sort(byAddressNumber).map((h) => {
    const a = drawAgg.get(h.id) ?? { credited: 0, pending: 0 };
    const budget = h.bankLoanAmount == null ? null : Number(h.bankLoanAmount);
    return {
      id: h.id,
      address: h.address,
      modelLabel:
        h.catalogModel || h.catalogLocation
          ? [h.catalogModel?.name, h.catalogLocation?.name].filter(Boolean).join(" · ")
          : null,
      budget,
      credited: a.credited,
      pendingAmount: a.pending,
      available: budget == null ? null : budget - a.credited - a.pending,
    };
  });
  const drawNone = drawAgg.get("__none__");
  if (drawNone) {
    drawHouses.push({
      id: null,
      address: "(draws sem casa)",
      modelLabel: null,
      budget: null,
      credited: drawNone.credited,
      pendingAmount: drawNone.pending,
      available: null,
    });
  }
  const drawRows: DrawRow[] = [...drawEntries]
    .sort((a, b) => Number(b.pending) - Number(a.pending) || b.date.getTime() - a.date.getTime())
    .map((d) => ({
      id: d.id,
      poolId: pool.id,
      poolCode: pool.code,
      houseId: d.houseId,
      houseAddress: d.house?.address ?? null,
      pending: d.pending,
      requestedAmount: d.requestedAmount?.toString() ?? null,
      requestDate: d.requestDate ? fmtDate(d.requestDate) : null,
      amount: d.amount.toString(),
      date: fmtDate(d.date),
      reconciled: d.reconciled,
      memo: d.memo,
    }));
  const feeBits: string[] = [];
  if (bp) {
    if (Number(bp.drawProcessingFee) > 0) feeBits.push(`$${Number(bp.drawProcessingFee)} processing`);
    if (Number(bp.inspectionFeePerDraw) > 0) feeBits.push(`$${Number(bp.inspectionFeePerDraw)} inspection`);
    if (Number(bp.achFeePerBatch) > 0) feeBits.push(`$${Number(bp.achFeePerBatch)} ACH por lote`);
  }
  const feesHint =
    feeBits.length > 0 ? `Fees previstos na liberação (${bp?.name}): ${feeBits.join(" + ")}.` : "";

  const drawableSum = linkedHouses.reduce((s, h) => s + Number(h.bankLoanAmount ?? 0), 0);
  const housesFootNote =
    loan && drawableSum > 0 && loan.committed != null
      ? `Soma dos loans das casas: ${formatMoney(drawableSum, pool.currency)} · comprometido do loan: ${formatMoney(Number(loan.committed), pool.currency)}${Math.abs(drawableSum - Number(loan.committed)) > 1 ? " (diferença = fees/reserve do envelope)" : ""}`
      : null;

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/pools/${pool.id}`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {pool.code}
          {pool.alias ? ` · ${pool.alias}` : ""}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Loan statement</h1>
        <p className="text-sm text-slate-500">
          O extrato interno do construction loan — draws, juros reais, fees e payoffs lançados
          aqui; o saldo devido é calculado e cada linha pode ser conciliada (✓) com o extrato do
          banco. Draws novos entram pela aba <b>Draws</b> deste loan.
        </p>
      </div>

      <PoolTabsNav poolId={pool.id} active="loan" />

      {/* Lembrete: juros mensais POR FORA nos loans ativos sem interest reserve */}
      {interestReminders.length > 0 && (
        <section className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
          <p className="mb-1 text-sm font-semibold text-amber-900">
            💰 Juros mensais por fora — {interestReminders.length === 1 ? "este loan não tem" : "estes loans não têm"} interest
            reserve: o pagamento sai do caixa todo mês.
          </p>
          <ul className="space-y-0.5">
            {interestReminders.map((r) => (
              <li key={r.id} className="text-xs text-amber-800">
                <span className="font-semibold">{r.label}</span>
                {r.monthly != null ? (
                  <>
                    {" — "}≈ <span className="font-bold tabular-nums">{formatMoney(r.monthly, pool.currency)}/mês</span>{" "}
                    ({r.aprL}% sobre {r.dutch ? "o comprometido (Dutch)" : `o saldo de ${formatMoney(r.baseAmt, pool.currency)}`})
                  </>
                ) : r.semLancamentos ? (
                  <> — sem lançamentos no statement ainda; lance os draws (ou suba o extrato) para estimar o juro mensal ({r.aprL}% sobre o sacado)</>
                ) : (
                  <> — defina o comprometido para estimar</>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Um pool pode ter N loans (bancos diferentes por grupo de casas) — seletor */}
      {pool.loans.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {pool.loans.map((l) => (
            <Link
              key={l.id}
              href={`/pools/${pool.id}/loan?loan=${l.id}`}
              className={`rounded-full border px-3 py-1.5 text-sm transition ${
                loan?.id === l.id
                  ? "border-[#1f3a5f] bg-[#1f3a5f] font-medium text-white"
                  : "border-slate-300 text-slate-600 hover:border-slate-400"
              }`}
            >
              {loanLabel(l)}
            </Link>
          ))}
          <Link
            href={`/pools/${pool.id}/loan?loan=new`}
            className={`rounded-full border border-dashed px-3 py-1.5 text-sm transition ${
              creatingNew
                ? "border-[#1f3a5f] font-medium text-[#1f3a5f]"
                : "border-slate-300 text-slate-500 hover:border-slate-400"
            }`}
          >
            + Novo loan
          </Link>
        </div>
      )}

      {/* KPIs (mock aprovado 17/07): as informações importantes do loan numa régua só */}
      {loan && stmt && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Card
            label="Total do loan"
            value={loan.committed != null ? formatMoney(Number(loan.committed), pool.currency) : "—"}
            hint="comprometido"
          />
          <Card
            label="Sacado (draws das casas)"
            value={formatMoney(stmt.totalDraws, pool.currency)}
            hint={
              loan.committed
                ? `${((stmt.totalDraws / Number(loan.committed)) * 100).toFixed(1)}% do total · fees ${formatMoney(stmt.totalFees, pool.currency)}`
                : `fees ${formatMoney(stmt.totalFees, pool.currency)}`
            }
          />
          <Card
            label="Disponível"
            value={
              loan.committed != null
                ? formatMoney(Math.max(0, Number(loan.committed) - stmt.totalDraws), pool.currency)
                : "—"
            }
            hint="p/ draws futuros"
          />
          <Card
            label="Juros pagos"
            value={formatMoney(interestView?.paidTotal ?? 0, pool.currency)}
            hint={
              interestView?.dueNow
                ? `devido agora ${formatMoney(interestView.dueNow, pool.currency)}`
                : apr != null
                  ? `cobrado ${formatMoney(stmt.totalInterest, pool.currency)} (APR ${apr}%)`
                  : undefined
            }
          />
          <Card
            label={
              stmt.totalPayoffs > 0 && stmt.balance <= 0.01 ? "Saldo devido — QUITADO" : "Saldo devido"
            }
            value={formatMoney(stmt.balance, pool.currency)}
            hint={
              stmt.totalPayoffs > 0 && stmt.balance <= 0.01
                ? `quitado · payoffs ${formatMoney(stmt.totalPayoffs, pool.currency)}`
                : `payoffs ${formatMoney(stmt.totalPayoffs, pool.currency)} · conciliado ${stmt.reconciledCount}/${stmt.rows.length}`
            }
          />
        </div>
      )}
      {loan && (
        <div className="flex gap-1 border-b-2 border-slate-200">
          {(
            [
              ["statement", "📑 Statement", null],
              ["docs", "📁 Documentos", loan.documents.length],
              ["terms", "⚙ Termos", null],
              ["houses", "🏠 Casas", linkedHouses.length],
              ["draws", "🏗 Draws", drawsPendingCount],
            ] as Array<[string, string, number | null]>
          ).map(([key, label, badge]) => (
            <Link
              key={key}
              href={`/pools/${pool.id}/loan?loan=${loan.id}&stab=${key}`}
              className={`-mb-0.5 rounded-t-lg border-b-2 px-4 py-2 text-sm transition ${
                stab === key
                  ? "border-[#1f3a5f] font-semibold text-[#1f3a5f]"
                  : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
            >
              {label}
              {badge != null && badge > 0 && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    (key === "docs" && loan.documents.some((d) => d.proposal != null)) ||
                    (key === "draws" && drawsPendingCount > 0)
                      ? "bg-amber-100 text-amber-800"
                      : "bg-slate-100 text-slate-500"
                  }`}
                >
                  {badge}
                </span>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* Documentos do financiamento (16/07): pasta por loan — o documento é a fonte */}
      {loan && stab === "docs" && (
        <PoolLoanDocs
          poolId={pool.id}
          loanId={loan.id}
          loanLabel={loanLabel(loan)}
          docs={loan.documents.map((d) => ({
            id: d.id,
            kind: d.kind as string,
            fileName: d.fileName,
            date: d.createdAt.toISOString().slice(0, 10),
            sizeKb: Math.max(1, Math.round(d.pdfSize / 1024)),
            summary: d.summary,
            appliedSummary: d.appliedSummary,
            applied: d.appliedAt != null,
            pending: (d.proposal as unknown as LoanDocProposalItem[] | null) ?? null,
            extractedJson: d.extracted != null ? JSON.stringify(d.extracted) : null,
          }))}
        />
      )}

      {/* criar loan novo: formulário direto (não há o que travar) */}
      {creatingNew && (
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="mb-3 text-base font-medium text-slate-800">
            {pool.loans.length > 0 ? "Novo loan" : "Termos do loan"}
          </h2>
          <PoolLoanTermsForm key="new" poolId={pool.id} loanId={null} banks={banks} loan={null} />
        </section>
      )}

      {/* aba TERMOS (mock aprovado 17/07): tudo visível e TRAVADO; Editar corrige a leitura */}
      {loan && !creatingNew && stab === "terms" && (
        <>
          <PoolLoanTermsView
            key={loan.id}
            poolId={pool.id}
            banks={banks}
            loan={{
              loanId: loan.id,
              bankProfileId: loan.bankProfileId,
              loanNumber: loan.loanNumber,
              committed: loan.committed?.toString() ?? null,
              committedFmt: loan.committed != null ? formatMoney(Number(loan.committed), pool.currency) : null,
              aprPct: loan.aprPct?.toString() ?? null,
              firstContactDate: loan.firstContactDate ? fmtDate(loan.firstContactDate) : null,
              expectedClosingDate: loan.expectedClosingDate ? fmtDate(loan.expectedClosingDate) : null,
              closingDate: loan.closingDate ? fmtDate(loan.closingDate) : null,
              interestDueDay: loan.interestDueDay?.toString() ?? null,
              graceDays: loan.graceDays?.toString() ?? null,
              lateFeePct: loan.lateFeePct?.toString() ?? null,
              notes: loan.notes,
              statusChip: paidOff
                ? { text: "quitado", tone: "slate" }
                : loan.closingDate
                  ? { text: "ativo", tone: "green" }
                  : { text: "aguardando closing", tone: "amber" },
              sourceChip: loiDoc
                ? `preenchido do LOI${loiEx?.loiDate ? ` de ${fmtBr(loiEx.loiDate)}` : ""} · leitura por AI`
                : null,
              contractText: contractDaysOf(loan),
            }}
            bank={termsBank}
            loi={loiEx ? { loiDate: loiEx.loiDate ?? null, prepayment: loiEx.prepaymentPenalty?.trim() || null } : null}
          />
          {loan.entries.length === 0 && (
            <form action={deletePoolLoan} className="text-right">
              <input type="hidden" name="loanId" value={loan.id} />
              <input type="hidden" name="poolId" value={pool.id} />
              <button
                type="submit"
                className="text-xs text-slate-400 hover:text-red-500"
                title="Remove o loan (só é possível sem lançamentos; as casas voltam a 'sem loan')"
              >
                ✕ Remover loan
              </button>
            </form>
          )}
        </>
      )}

      {/* aba CASAS (mock aprovado 17/07 + modal): só as casas DESTE loan */}
      {loan && !creatingNew && stab === "houses" && (
        <PoolLoanHousesTab
          poolId={pool.id}
          loanId={loan.id}
          loanLabel={loanLabel(loan)}
          houses={houseRows}
          unlinked={unlinkedHouses}
          footNote={housesFootNote}
        />
      )}

      {/* aba DRAWS (mock aprovado 17/07): a gestão mora aqui — o menu Draws é só dash */}
      {loan && !creatingNew && stab === "draws" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card label="Aprovado (casas do loan)" value={formatMoney(drawsBudget, pool.currency)} hint={`${linkedHouses.length} casas`} />
            <Card label="Creditado" value={formatMoney(drawsCredited, pool.currency)} hint="draws liberados pelo banco" />
            <Card
              label="Aguardando banco"
              value={formatMoney(drawsAwaiting, pool.currency)}
              hint={drawsPendingCount > 0 ? `${drawsPendingCount} ${drawsPendingCount === 1 ? "draw solicitado" : "draws solicitados"}` : "nenhum pendente"}
            />
            <Card
              label="Disponível"
              value={formatMoney(Math.max(0, drawsBudget - drawsCredited - drawsAwaiting), pool.currency)}
              hint="aprovado − creditado − aguardando"
            />
          </div>
          <DrawHousesPanel
            poolId={pool.id}
            loanId={loan.id}
            poolLabel={loanLabel(loan)}
            feesHint={feesHint}
            houses={drawHouses}
          />
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-medium text-slate-800">Ledger de draws</h2>
              <p className="text-xs text-slate-400">
                Pendentes primeiro. Clique na linha para editar / registrar a liberação — o
                DRAW entra no statement na data da liberação{feesHint ? ` (${feesHint.toLowerCase()})` : ""}. ✓ =
                conciliado com o extrato.
              </p>
            </div>
            <DrawList
              draws={drawRows}
              housesByPool={{ [pool.id]: pool.houses.map((h) => ({ id: h.id, address: h.address })) }}
            />
          </section>
        </>
      )}

      {loan && stmt && stab === "statement" && (
        <>
          <LoanChargesPanel poolId={pool.id} loanId={loan.id} candidates={chargeCandidates} fundedNote={fundedNote} />
          {interestRows.length > 0 && (
            <LoanInterestPanel
              poolId={pool.id}
              loanId={loan.id}
              rows={interestRows}
              ruleText={interestRule}
              footNote={
                loan.bankProfile && !loan.bankProfile.hasInterestReserve
                  ? "Sem interest reserve — o pagamento sai do caixa do pool todo mês."
                  : null
              }
            />
          )}
          {pendingPayoffs.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
              <p className="mb-2 text-sm text-amber-800">
                Casas vendidas com payoff ainda não lançado no statement:
              </p>
              <div className="flex flex-wrap gap-2">
                {pendingPayoffs.map((h) => (
                  <form key={h.id} action={generatePayoffFromHouse}>
                    <input type="hidden" name="poolId" value={pool.id} />
                    <input type="hidden" name="houseId" value={h.id} />
                    <button
                      type="submit"
                      className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs text-amber-800 hover:bg-amber-100"
                    >
                      Lançar payoff • {h.address} · {formatMoney(h.payoffAmount!, pool.currency)}
                    </button>
                  </form>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="flex items-end justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-base font-medium text-slate-800">Statement</h2>
                <p className="text-xs text-slate-400">
                  Nas linhas de juro, "esperado" é o accrual diário (APR/360) sobre o saldo — o
                  delta confere a cobrança do banco. O saldo é sempre acumulado desde o início.
                </p>
              </div>
              <LoanMonthFilter months={months} value={month} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={th}>Data</th>
                    <th className={th}>Tipo</th>
                    <th className={th}>Casa / memo</th>
                    <th className={thRight}>Valor</th>
                    <th className={thRight}>Saldo devido</th>
                    <th className={thRight}>Esperado (juro)</th>
                    <th className={thRight}>✓</th>
                    <th className={thRight}></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-5 py-6 text-center text-sm text-slate-400">
                        {month === "all"
                          ? "Nenhum lançamento ainda — comece pelos fees do closing e a reserve."
                          : "Nenhum lançamento neste mês."}
                      </td>
                    </tr>
                  )}
                  {visibleRows.map((e) => (
                    <tr key={e.id} className={`border-b border-slate-50 ${e.reconciled ? "" : "bg-amber-50/30"}`}>
                      <td className={td}>{fmtDate(e.date)}</td>
                      <td className={td}>
                        <span
                          className={`text-xs ${
                            e.type === "PAYOFF" || e.type === "CREDIT"
                              ? "text-emerald-700"
                              : e.type === "INTEREST"
                                ? "text-blue-700"
                                : "text-slate-500"
                          }`}
                        >
                          {ENTRY_TYPE_LABEL[e.type] ?? e.type}
                        </span>
                      </td>
                      <td className={`${td} text-slate-500`}>
                        {e.houseLabel ?? ""}
                        {e.houseLabel && e.memo ? " · " : ""}
                        {e.memo ?? ""}
                      </td>
                      <td className={`${tdRight} ${e.amount < 0 ? "text-emerald-700" : ""}`}>
                        {formatMoney(e.amount, pool.currency)}
                      </td>
                      <td className={`${tdRight} font-medium`}>{formatMoney(e.balance, pool.currency)}</td>
                      <td className={tdRight}>
                        {e.expectedInterest != null ? (
                          <span
                            title={`delta ${formatMoney(e.interestDelta ?? 0, pool.currency)}`}
                            className={
                              Math.abs(e.interestDelta ?? 0) > Math.abs(e.expectedInterest) * 0.05
                                ? "text-amber-600"
                                : "text-slate-400"
                            }
                          >
                            {formatMoney(e.expectedInterest, pool.currency)}
                          </span>
                        ) : (
                          ""
                        )}
                      </td>
                      <td className={tdRight}>
                        <form action={toggleLoanEntryReconciled} className="inline">
                          <input type="hidden" name="entryId" value={e.id} />
                          <input type="hidden" name="poolId" value={pool.id} />
                          <button
                            type="submit"
                            title={e.reconciled ? "Conciliado — clique para desfazer" : "Marcar como conciliado com o extrato"}
                            className={e.reconciled ? "text-emerald-600" : "text-slate-300 hover:text-emerald-600"}
                          >
                            ✓
                          </button>
                        </form>
                      </td>
                      <td className={tdRight}>
                        <form action={deleteLoanEntry} className="inline">
                          <input type="hidden" name="entryId" value={e.id} />
                          <input type="hidden" name="poolId" value={pool.id} />
                          <button type="submit" className="text-xs text-slate-300 hover:text-red-500" title="Delete">
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
              <AddLoanEntryForm
                poolId={pool.id}
                loanId={loan.id}
                houses={pool.houses
                  .filter((h) => h.loanId === loan.id || h.loanId == null)
                  .map((h) => ({ id: h.id, address: h.address }))}
              />
            </div>
          </section>
        </>
      )}
    </div>
  );
}
