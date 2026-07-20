import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { effectiveDrawStatus } from "@/lib/pools/draws";
import { formatMoney } from "@/lib/money";
import { buildStatement, ENTRY_TYPE_LABEL } from "@/lib/pools/loan-statement";
import {
  deleteLoanEntry,
  deletePoolLoan,
  generatePayoffFromHouse,
  toggleLoanEntryReconciled,
} from "@/lib/actions/pool-loan";
import { Fragment } from "react";
import { PoolLoanTermsForm } from "@/components/pool-loan-forms";
import { LaunchEntryButton, LaunchInterestButton } from "@/components/pool-loan-modals";
import { PoolLoanTermsView } from "@/components/pool-loan-terms-view";
import { PoolLoanHousesTab, type LoanHouseRow } from "@/components/pool-loan-houses";
import {
  LoanChargesPanel,
  LoanInterestPanel,
  type ChargeCandidate,
  type InterestRow,
} from "@/components/pool-loan-interest-panels";
import { computeLoanInterest } from "@/lib/pools/loan-interest";
import { LoanSufficiencyPanel, PoolSufficiencySummary } from "@/components/pool-loan-sufficiency";
import { computeSuffAggs, rawChargeCandidatesOf } from "@/lib/pools/loan-sufficiency";
import { DrawHousesPanel, type HouseAvailability } from "@/components/pool-draw-houses";
import { DrawList, type DrawRow } from "@/components/pool-draw-list";
import { LoanBudgetEditor } from "@/components/loan-budget-editor";
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
          budgetLines: { orderBy: { sortOrder: "asc" } },
        },
      },
      expenses: { select: { amount: true } },
    },
  });
  if (!pool) notFound();
  // seletor: ?loan=<id> | "new" (formulário vazio p/ criar) | default = primeiro loan
  const creatingNew = rawLoan === "new" || pool.loans.length === 0;
  const loan = creatingNew ? null : (pool.loans.find((l) => l.id === rawLoan) ?? pool.loans[0]);
  // catálogo de marcos p/ o dropdown do budget do banco (leva 2 dos marcos)
  const milestoneCatalogForBudget = (
    await prisma.catalogBuildMilestone.findMany({ orderBy: { sortOrder: "asc" }, select: { key: true, name: true } })
  ).map((m) => ({ key: m.key, name: m.name }));
  // sub-abas internas (17/07): Statement | Juros | Documentos | Termos | Casas | Draws
  const stab = ["interest", "docs", "terms", "houses", "draws"].includes(rawStab ?? "")
    ? rawStab!
    : "statement";
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
  // Suficiência do financiamento (17/07, fórmula do Stefan + modalidade do envelope):
  // POR DENTRO (feesInEnvelope ≠ false): fees consomem o teto — fee de draw COM casa
  // desconta da própria casa; o resto (closing/reserve/crédito) rateia pelo drawable.
  // POR FORA: fees somam ao comprometido — nada desconta da obra.
  const inEnvelope = loan ? loan.feesInEnvelope !== false : true;
  const feesByHouse = new Map<string, number>();
  let loanConsumedGeneral = 0;
  if (loan) {
    for (const e of loan.entries.filter(
      (x) => !x.pending && ["CLOSING_FEE", "OTHER", "RESERVE", "DRAW_FEE"].includes(x.type),
    )) {
      if (e.type === "DRAW_FEE" && e.houseId)
        feesByHouse.set(e.houseId, (feesByHouse.get(e.houseId) ?? 0) + Number(e.amount));
      else loanConsumedGeneral += Number(e.amount);
    }
  }
  const loanConsumed = loanConsumedGeneral + [...feesByHouse.values()].reduce((s, v) => s + v, 0);
  const loanDrawableTotal = linkedHouses.reduce((s, h) => s + Number(h.bankLoanAmount ?? 0), 0);
  const suffOf = (h: (typeof pool.houses)[number]) => {
    const drawable = h.bankLoanAmount != null ? Number(h.bankLoanAmount) : null;
    const obra = h.plannedBuildCost != null ? Number(h.plannedBuildCost) : null;
    if (drawable == null || obra == null) return null;
    const lote = Number(h.actualLotCost ?? h.plannedLotCost ?? 0);
    const aporte = Number(h.ownCapital ?? 0);
    const equityObra = Math.max(0, aporte - lote); // aporte próprio além do lote
    const necessario = Math.max(0, obra - equityObra);
    const consumido = inEnvelope
      ? (loanDrawableTotal > 0 ? loanConsumedGeneral * (drawable / loanDrawableTotal) : 0) +
        (feesByHouse.get(h.id) ?? 0)
      : 0;
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
        date: `${fmtDate(e.date).slice(5, 7)}/${fmtDate(e.date).slice(8, 10)}/${fmtDate(e.date).slice(0, 4)}`,
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
  const chargeCandidates: ChargeCandidate[] = loan
    ? rawChargeCandidatesOf(loan, pool.expenses.map((e) => Number(e.amount))).map((c) => ({
        key: `${c.docId}:${c.idx}`,
        name: c.name,
        source: `«${c.fileName}»`,
        date: c.date || fmtDate(new Date()),
        amountFmt: formatMoney(c.amount, pool.currency),
        amount: c.amount,
        target: c.isCredit ? "CREDIT_IN" : c.financed ? "DEBT" : "EXPENSE",
      }))
    : [];
  let fundedNote: string | null = null;
  if (loan) {
    for (const d of loan.documents.filter(
      (dd) => ["AGREEMENT", "NOTE", "SETTLEMENT"].includes(dd.kind) && dd.extracted != null,
    )) {
      const ex2 = d.extracted as ExLite;
      if (ex2.endingBalance && ex2.endingBalance > 0) {
        fundedNote = `Referência do banco: saldo ${formatMoney(ex2.endingBalance, pool.currency)} («${d.fileName}»).`;
        break;
      }
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
    paidFmt: p.paid > 0 ? formatMoney(p.paid, pool.currency) : null,
    dueDate: `${p.dueDate.slice(5, 7)}/${p.dueDate.slice(8, 10)}/${p.dueDate.slice(0, 4)}`,
    dDays: Math.ceil((new Date(p.dueDate).getTime() - Date.now()) / dayMs0),
    status: p.status,
    owed: Math.max(0, Math.round((p.owed - p.paid) * 100) / 100),
  }));
  const interestRule = loan
    ? `Vencimento: dia ${loan.interestDueDay ?? 1} do mês seguinte${loan.graceDays ? ` · grace ${loan.graceDays} dias` : ""}${loan.lateFeePct ? ` · multa ${Number(loan.lateFeePct)}%` : ""} — ${loan.interestDueDay ? "lido do contrato (editável nos Termos)" : "padrão (a leitura do contrato preenche; editável nos Termos)"}. Esperado = accrual diário APR/360 sobre o saldo; cobrado vem do extrato do banco.`
    : "";

  // ── separação PRINCIPAL × JUROS EM ABERTO (mock aprovado 17/07): o juro entra e sai
  // sem embolar o extrato — saldo devido total = principal + juros em aberto. O lembrete
  // de juros saiu do header (mora no menu Juros). Datas em MM/DD/YYYY.
  const round2p = (v: number) => Math.round(v * 100) / 100;
  const fmtUS = (d: Date | string | null): string => {
    if (d == null) return "—";
    const isoS = typeof d === "string" ? d : fmtDate(d);
    return `${isoS.slice(5, 7)}/${isoS.slice(8, 10)}/${isoS.slice(0, 4)}`;
  };
  const monthTag = (d: Date) =>
    `${d.toLocaleString("en-US", { month: "long", timeZone: "UTC" }).toUpperCase()} ${d.getUTCFullYear()}`;
  const runMap = new Map<string, { principal: number; juros: number }>();
  {
    let pRun = 0;
    let jRun = 0;
    for (const r of stmt?.rows ?? []) {
      if (r.type === "INTEREST" || r.type === "INTEREST_PAYMENT") jRun = round2p(jRun + r.amount);
      else pRun = round2p(pRun + r.amount);
      runMap.set(r.id, { principal: pRun, juros: jRun });
    }
  }
  const jurosAbertos = round2p(
    (loan?.entries ?? [])
      .filter((e) => !e.pending && (e.type === "INTEREST" || e.type === "INTEREST_PAYMENT"))
      .reduce((s, e) => s + Number(e.amount), 0),
  );
  const principalDevido = round2p((stmt?.balance ?? 0) - jurosAbertos);
  const reserveFinanced = round2p(
    (loan?.entries ?? [])
      .filter((e) => !e.pending && e.type === "RESERVE")
      .reduce((s, e) => s + Number(e.amount), 0),
  );

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
      drawNumber: d.drawNumber,
      drawStatus: effectiveDrawStatus(d),
      denyReason: d.denyReason,
      requestedAmount: d.requestedAmount?.toString() ?? null,
      requestDate: d.requestDate ? fmtDate(d.requestDate) : null,
      amount: d.amount.toString(),
      date: fmtDate(d.date),
      reconciled: d.reconciled,
      memo: d.memo,
    }));
  // ── envelope do loan (17/07): a trava real é o teto — na modalidade "por dentro" os
  // fees consumidos roubam espaço da obra; o DESCOBERTO = orçamentos + consumido − teto
  // é o que faltará no FINAL (os últimos draws não cabem). Visível sempre.
  const envelopeRest =
    loan?.committed != null
      ? Number(loan.committed) - (inEnvelope ? loanConsumed : 0) - drawsCredited - drawsAwaiting
      : null;
  const descoberto =
    loan?.committed != null ? drawsBudget + (inEnvelope ? loanConsumed : 0) - Number(loan.committed) : null;
  const casasTotals = (() => {
    let drawn = 0;
    let interest = 0;
    for (const h of linkedHouses) {
      const es = entriesOfHouse(h.id).filter((e) => !e.pending);
      drawn += es.filter((e) => e.type === "DRAW").reduce((s, e) => s + Number(e.amount), 0);
      interest += Math.abs(
        es.filter((e) => e.type === "INTEREST_PAYMENT").reduce((s, e) => s + Number(e.amount), 0),
      );
    }
    return {
      drawableFmt: formatMoney(drawsBudget, pool.currency),
      drawnFmt: drawn > 0 ? formatMoney(drawn, pool.currency) : "—",
      availableFmt: formatMoney(Math.max(0, drawsBudget - drawn), pool.currency),
      interestFmt: interest > 0 ? formatMoney(interest, pool.currency) : "—",
    };
  })();
  const envelopeLine =
    loan?.committed != null && descoberto != null
      ? {
          comprFmt: formatMoney(Math.max(0, drawsBudget - drawsCredited - drawsAwaiting), pool.currency),
          envFmt: formatMoney(envelopeRest ?? 0, pool.currency),
          descoberto: descoberto > 0.01,
          descobertoFmt: formatMoney(Math.abs(descoberto), pool.currency),
        }
      : null;

  const feeBits: string[] = [];
  if (bp) {
    if (Number(bp.drawProcessingFee) > 0) feeBits.push(`$${Number(bp.drawProcessingFee)} processing`);
    if (Number(bp.inspectionFeePerDraw) > 0) feeBits.push(`$${Number(bp.inspectionFeePerDraw)} inspection`);
    if (Number(bp.achFeePerBatch) > 0) feeBits.push(`$${Number(bp.achFeePerBatch)} ACH por lote`);
  }
  const feesHint =
    feeBits.length > 0 ? `Fees previstos na liberação (${bp?.name}): ${feeBits.join(" + ")}.` : "";

  // Suficiência — FONTE ÚNICA em lib/pools/loan-sufficiency (usada também no Overview)
  const suffAggs = computeSuffAggs(pool, new Date());
  const suffSelected = loan ? suffAggs.find((a) => a.loanId === loan.id) ?? null : null;

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

      {/* Loans como SUB-ABAS (pedido 17/07 — não cards); o lembrete de juros mora no menu Juros */}
      {pool.loans.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b-2 border-slate-200">
          {pool.loans.map((l) => (
            <Link
              key={l.id}
              href={`/pools/${pool.id}/loan?loan=${l.id}`}
              className={`-mb-0.5 rounded-t-lg border-b-2 px-4 py-2 text-sm transition ${
                loan?.id === l.id
                  ? "border-[#1f3a5f] font-semibold text-[#1f3a5f]"
                  : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              }`}
            >
              {loanLabel(l)}
            </Link>
          ))}
          <Link
            href={`/pools/${pool.id}/loan?loan=new`}
            className={`-mb-0.5 rounded-t-lg border-b-2 px-4 py-2 text-sm transition ${
              creatingNew
                ? "border-[#1f3a5f] font-semibold text-[#1f3a5f]"
                : "border-transparent text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            }`}
          >
            + Novo loan
          </Link>
        </div>
      )}

      {/* KPIs (mock aprovado 17/07): principal × juros em aberto separados */}
      {loan && stmt && (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <Card
            label="Total do loan"
            value={loan.committed != null ? formatMoney(Number(loan.committed), pool.currency) : "—"}
            hint="comprometido"
          />
          <Card
            label="Sacado (obra)"
            value={formatMoney(stmt.totalDraws, pool.currency)}
            hint={
              loan.committed
                ? `${((stmt.totalDraws / Number(loan.committed)) * 100).toFixed(1)}% do total`
                : undefined
            }
          />
          <Card
            label="Disponível"
            value={formatMoney(
              envelopeRest ?? Math.max(0, drawsBudget - drawsCredited - drawsAwaiting),
              pool.currency,
            )}
            hint={envelopeRest != null ? "envelope − consumido − sacado" : "p/ draws futuros"}
          />
          <Card
            label={
              stmt.totalPayoffs > 0 && stmt.balance <= 0.01 ? "Principal — QUITADO" : "Principal devido"
            }
            value={formatMoney(principalDevido, pool.currency)}
            hint={`payoffs ${formatMoney(stmt.totalPayoffs, pool.currency)} · conciliado ${stmt.reconciledCount}/${stmt.rows.length}`}
          />
          <Card
            label="Juros em aberto"
            value={formatMoney(jurosAbertos, pool.currency)}
            hint={
              interestView?.nextDue
                ? `vencimento ${fmtUS(interestView.nextDue.date)} → aba Juros`
                : "→ aba Juros"
            }
          />
        </div>
      )}
      {loan && (
        <div className="flex gap-1 border-b-2 border-slate-200">
          {(
            [
              ["statement", "📑 Statement", null],
              [
                "interest",
                "💰 Juros",
                interestView && interestView.dueNow > 0 ? `$${Math.round(interestView.dueNow)}` : null,
              ],
              ["docs", "📁 Documentos", loan.documents.length],
              ["terms", "⚙ Termos", null],
              ["houses", "🏠 Casas", linkedHouses.length],
              ["draws", "🏗 Draws", drawsPendingCount],
            ] as Array<[string, string, number | string | null]>
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
              {badge != null && (typeof badge === "string" || badge > 0) && (
                <span
                  className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                    (key === "docs" && loan.documents.some((d) => d.proposal != null)) ||
                    (key === "draws" && drawsPendingCount > 0) ||
                    key === "interest"
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
              feesInEnvelope: loan.feesInEnvelope === true ? "IN" : loan.feesInEnvelope === false ? "OUT" : "",
              notes: loan.notes,
              statusChip: paidOff
                ? { text: "quitado", tone: "slate" }
                : loan.closingDate
                  ? { text: "ativo", tone: "green" }
                  : { text: "aguardando closing", tone: "amber" },
              sourceChip: loiDoc
                ? `preenchido do LOI${loiEx?.loiDate ? ` de ${loiEx.loiDate.slice(5, 7)}/${loiEx.loiDate.slice(8, 10)}/${loiEx.loiDate.slice(0, 4)}` : ""} · leitura por AI`
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
          totals={casasTotals}
          envelope={envelopeLine}
        />
      )}
      {/* suficiência mora na aba Casas (mock aprovado 17/07 — é conta de obra/casa) */}
      {loan && !creatingNew && stab === "houses" && (
        <>
          {suffSelected && <LoanSufficiencyPanel a={suffSelected} cur={pool.currency} />}
          {pool.loans.length > 1 && <PoolSufficiencySummary aggs={suffAggs} cur={pool.currency} />}
        </>
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
              label={envelopeRest != null ? "Envelope restante" : "Disponível"}
              value={formatMoney(
                envelopeRest ?? Math.max(0, drawsBudget - drawsCredited - drawsAwaiting),
                pool.currency,
              )}
              hint={
                envelopeRest != null
                  ? `teto${inEnvelope ? " − consumido" : ""} − sacado − aguardando`
                  : "aprovado − creditado − aguardando"
              }
            />
          </div>
          {descoberto != null && descoberto > 0.01 && (
            <section className="rounded-xl border border-amber-200 bg-amber-50/60 px-4 py-3">
              <p className="text-sm font-semibold text-amber-900">
                ⚠ Descoberto do envelope: os orçamentos das casas{inEnvelope ? " + o que o closing já consumiu" : ""} somam{" "}
                {formatMoney(drawsBudget + (inEnvelope ? loanConsumed : 0), pool.currency)}, mas o teto do loan é{" "}
                {formatMoney(Number(loan.committed), pool.currency)} — os últimos draws ficarão{" "}
                <b>{formatMoney(descoberto, pool.currency)}</b> descobertos (aporte dos sócios ou redução de orçamento).
              </p>
            </section>
          )}
          <LoanBudgetEditor
            loanId={loan.id}
            milestones={milestoneCatalogForBudget}
            retainagePct={loan.retainagePct != null ? loan.retainagePct.toString() : ""}
            expectedDraws={loan.expectedDraws != null ? String(loan.expectedDraws) : ""}
            initial={loan.budgetLines.map((b) => ({
              label: b.label,
              pct: Number(b.pct),
              milestoneKey: b.milestoneKey,
            }))}
          />
          <DrawHousesPanel
            poolId={pool.id}
            loanId={loan.id}
            poolLabel={loanLabel(loan)}
            feesHint={feesHint}
            houses={drawHouses}
          />
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-medium text-slate-800">Ledger de draws</h2>
                {(() => {
                  const maxDraw = drawEntries.reduce((m, e) => Math.max(m, e.drawNumber ?? 0), 0);
                  if (maxDraw === 0) return null;
                  return (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      Draw #{maxDraw}
                      {loan.expectedDraws ? ` de ~${loan.expectedDraws}` : ""}
                    </span>
                  );
                })()}
              </div>
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

      {/* aba JUROS (mock aprovado 17/07): saem do Statement — KPIs, períodos e lançamentos */}
      {loan && stab === "interest" && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card
              label="Cobrado acumulado"
              value={formatMoney(interestView?.chargedTotal ?? 0, pool.currency)}
              hint="linhas INTEREST do extrato"
            />
            <Card
              label="Pago acumulado"
              value={formatMoney(interestView?.paidTotal ?? 0, pool.currency)}
              hint={
                loan.bankProfile?.hasInterestReserve
                  ? `reserve financiada ${formatMoney(reserveFinanced, pool.currency)}`
                  : "do caixa do pool"
              }
            />
            <Card
              label="Devido agora"
              value={formatMoney(interestView?.dueNow ?? 0, pool.currency)}
              hint={interestView && interestView.dueNow > 0 ? "períodos fechados não cobertos" : "nada vencido"}
            />
            <Card
              label="Próximo vencimento"
              value={interestView?.nextDue ? fmtUS(interestView.nextDue.date) : "—"}
              hint={
                interestView?.nextDue
                  ? `${(() => {
                      const dd = Math.ceil((new Date(interestView.nextDue.date).getTime() - Date.now()) / dayMs0);
                      return dd < 0 ? `vencido há ${-dd}d` : `D-${dd}`;
                    })()}${loan.graceDays ? ` · grace ${loan.graceDays}d` : ""}${loan.lateFeePct ? ` · multa ${Number(loan.lateFeePct)}%` : ""}`
                  : loan.closingDate
                    ? "sem juros em aberto"
                    : "sem juros até o closing"
              }
            />
          </div>
          <div className="flex items-center justify-between">
            {loan.bankProfile && !loan.bankProfile.hasInterestReserve ? (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                💰 sem interest reserve — o pagamento sai do caixa do pool todo mês
              </span>
            ) : (
              <span />
            )}
            <LaunchInterestButton
              poolId={pool.id}
              loanId={loan.id}
              hasReserve={loan.bankProfile?.hasInterestReserve ?? false}
            />
          </div>
          {interestRows.length > 0 ? (
            <LoanInterestPanel
              poolId={pool.id}
              loanId={loan.id}
              rows={interestRows}
              ruleText={interestRule}
              footNote={null}
            />
          ) : (
            <p className="rounded-xl border border-dashed border-slate-300 px-4 py-6 text-center text-sm text-slate-400">
              Sem períodos ainda — os juros começam no closing do loan.
            </p>
          )}
        </>
      )}

      {loan && stmt && stab === "statement" && (
        <>
          <LoanChargesPanel poolId={pool.id} loanId={loan.id} candidates={chargeCandidates} fundedNote={fundedNote} />
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
            <div className="flex items-end justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-base font-medium text-slate-800">Statement</h2>
                <p className="text-xs text-slate-400">
                  Agrupado por mês. As colunas separam o caminho do <b>principal</b> (draws +
                  fees + crédito) e dos <b>juros em aberto</b> (cobrados − pagos) — o juro entra
                  e sai sem embolar o saldo. Detalhe dos juros na aba <b>Juros</b>.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <LoanMonthFilter months={months} value={month} />
                <LaunchEntryButton
                  poolId={pool.id}
                  loanId={loan.id}
                  houses={pool.houses
                    .filter((h) => h.loanId === loan.id || h.loanId == null)
                    .map((h) => ({ id: h.id, address: h.address }))}
                />
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={th}>Date</th>
                    <th className={th}>Tipo</th>
                    <th className={th}>Casa / memo</th>
                    <th className={thRight}>Valor</th>
                    <th className={thRight}>Principal</th>
                    <th className={thRight}>Juros abertos</th>
                    <th className={thRight}>Saldo total</th>
                    <th className={thRight}>✓</th>
                    <th className={thRight}></th>
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-5 py-6 text-center text-sm text-slate-400">
                        {month === "all"
                          ? "Nenhum lançamento ainda — comece pelos fees do closing e a reserve."
                          : "Nenhum lançamento neste mês."}
                      </td>
                    </tr>
                  )}
                  {visibleRows.map((e, i) => {
                    const run = runMap.get(e.id);
                    const isInterest = e.type === "INTEREST" || e.type === "INTEREST_PAYMENT";
                    const prevRow = i > 0 ? visibleRows[i - 1] : null;
                    const newMonth = !prevRow || monthKey(prevRow.date) !== monthKey(e.date);
                    return (
                      <Fragment key={e.id}>
                        {newMonth && (
                          <tr>
                            <td colSpan={9} className="bg-slate-50 px-3 py-1 text-[10.5px] font-bold tracking-widest text-slate-500">
                              {monthTag(e.date)}
                            </td>
                          </tr>
                        )}
                        <tr className={`border-b border-slate-50 ${e.reconciled ? "" : "bg-amber-50/30"}`}>
                          <td className={td}>{fmtUS(e.date)}</td>
                          <td className={td}>
                            <span
                              className={`text-xs ${
                                e.type === "PAYOFF" || e.type === "CREDIT" || e.type === "INTEREST_PAYMENT"
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
                          <td
                            className={`${tdRight} ${
                              e.amount < 0 ? "text-emerald-700" : e.type === "INTEREST" ? "text-blue-700" : ""
                            }`}
                          >
                            {formatMoney(e.amount, pool.currency)}
                          </td>
                          <td className={`${tdRight} ${isInterest ? "text-slate-300" : "font-medium"}`}>
                            {formatMoney(run?.principal ?? 0, pool.currency)}
                          </td>
                          <td
                            className={`${tdRight} ${
                              (run?.juros ?? 0) > 0.01 ? "font-medium text-amber-700" : "text-slate-300"
                            }`}
                          >
                            {(run?.juros ?? 0) !== 0 ? formatMoney(run!.juros, pool.currency) : "—"}
                          </td>
                          <td className={`${tdRight} font-medium`}>{formatMoney(e.balance, pool.currency)}</td>
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
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
