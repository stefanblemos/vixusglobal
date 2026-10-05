"use client";

import { useActionState, useState, useTransition } from "react";
import Link from "next/link";
import {
  addHouseCashEntry,
  deleteHouseCashEntry,
  patchHouse,
  registerSale,
  returnExcessToPool,
  setHouseDate,
  type FormState,
} from "@/lib/actions/pools";
import { CASH_CATEGORIES, type LedgerRow } from "@/lib/pools/house-cash";

// Página da casa em LINHA DO TEMPO (mock aprovado 05/10/2026): cada etapa guarda data, valor
// e ação no mesmo lugar; a etapa atual fica aberta. Ao lado, o extrato da casa (entrou × saiu)
// e o planejado × real. Status, % de obra, capital próprio e lucro são calculados, nunca
// digitados. Cada etapa tem a sua form pequena (patchHouse grava só o que vier).

const inputClass =
  "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm tabular-nums outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-0.5 block text-[10.5px] font-semibold uppercase tracking-wider text-slate-500";
const btnClass =
  "rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-60";
const ghostClass =
  "rounded-lg border border-[#1f3a5f] bg-white px-3 py-1.5 text-xs font-semibold text-[#1f3a5f] hover:bg-blue-50 disabled:opacity-50";

const STATUSES = [
  ["PLANNED", "Planejada"],
  ["LOT_PURCHASED", "Lote"],
  ["UNDER_CONSTRUCTION", "Obra"],
  ["FOR_SALE", "À venda"],
  ["UNDER_CONTRACT", "Sob contrato"],
  ["SOLD", "Vendida"],
] as const;

export type HouseDates = {
  lotContractDate: string;
  lotPaidDate: string;
  permitAppliedDate: string;
  permitIssuedDate: string;
  buildStartDate: string;
  coDate: string;
  listedDate: string;
  contractDate: string;
  saleDate: string;
};

export type HouseView = {
  id: string;
  poolId: string;
  crumb: string;
  currency: string;
  address: string;
  status: string;
  modelName: string | null;
  locationName: string | null;
  catalogModelId: string;
  catalogLocationId: string;
  catalog: {
    locations: Array<{ id: string; name: string }>;
    modelLocations: Array<{ locationId: string; modelId: string; modelName: string }>;
  };
  loanId: string;
  loans: Array<{ id: string; label: string }>;
  loanInfo: { label: string; closingDate: string | null; apr: number | null; paidOff: boolean; balance: number } | null;
  bank: Record<"bankName" | "bankLoanAmount" | "bankOriginationFee" | "bankInterestReserve" | "bankCashToClose" | "bankBudgetReviewFee" | "bankCharges", string>;
  pinLocation: string;
  lockboxCode: string;
  notes: string;
  planned: { lot: number | null; build: number | null; sale: number | null; closing: number | null };
  actual: {
    lot: number | null; build: number | null; otherCosts: number; ownCapital: number | null;
    sale: number | null; payoff: number | null; net: number | null; closing: number | null;
  };
  coTotal: number;
  coCount: number;
  draws: Array<{ date: string; amount: number; memo: string | null; pending: boolean }>;
  drawn: number;
  buildPct: number | null;
  milestonesDone: number;
  milestonesTotal: number;
  dates: HouseDates;
  ledger: { rows: LedgerRow[]; totalIn: number; totalOut: number; balance: number; saleIn: number };
  distributionsHref: string;
  loanHref: string;
};

const fmt2 = (n: number) =>
  n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const usd = (n: number) => (n < 0 ? "−$" : "$") + Math.abs(Math.round(n)).toLocaleString("en-US");
const br = (iso: string) => (iso ? iso.split("-").reverse().join("/") : "");
const p = (s: string): number | null => {
  const t = s.replace(/,/g, "").trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

function Delta({ value, goodWhenNegative }: { value: number | null; goodWhenNegative: boolean }) {
  if (value == null) return <span className="text-xs text-slate-400">—</span>;
  if (Math.round(value) === 0) return <span className="text-xs text-slate-400">=</span>;
  const good = goodWhenNegative ? value < 0 : value > 0;
  return (
    <span className={`text-sm font-semibold tabular-nums ${good ? "text-emerald-700" : "text-red-700"}`}>
      {(value < 0 ? "−" : "+") + fmt2(Math.abs(value))}
    </span>
  );
}

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-extrabold tabular-nums text-slate-800">{value}</div>
      {sub && <div className="text-[11px] text-slate-400">{sub}</div>}
    </div>
  );
}

// Chip de data da linha do tempo: vazio = âmbar tracejado com input; preenchido = carimbo.
function DateChip({ houseId, field, label, value }: { houseId: string; field: keyof HouseDates; label: string; value: string }) {
  const [pending, start] = useTransition();
  const [editing, setEditing] = useState(false);
  const save = (date: string) => {
    const fd = new FormData();
    fd.set("houseId", houseId);
    fd.set("field", field);
    fd.set("date", date);
    start(async () => {
      await setHouseDate(fd);
      setEditing(false);
    });
  };
  if (value && !editing)
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Clique para ajustar"
        className="mr-1.5 mt-1 inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-100"
      >
        ✓ {label}: {br(value)}
      </button>
    );
  return (
    <span className="mr-1.5 mt-1 inline-flex items-center gap-1 rounded-full border border-dashed border-amber-400 bg-amber-50 px-2.5 py-0.5 text-[11px] font-semibold text-amber-800">
      {label}:
      <input
        type="date"
        defaultValue={value}
        disabled={pending}
        onChange={(e) => e.target.value && save(e.target.value)}
        className="w-[118px] border-0 bg-transparent p-0 text-[11px] text-amber-900 outline-none"
      />
      {value && (
        <button type="button" onClick={() => save("")} title="Limpar" className="text-amber-500 hover:text-red-600">
          ✕
        </button>
      )}
      {pending && <span className="text-amber-500">…</span>}
    </span>
  );
}

function Stage({
  n, title, right, state, children,
}: {
  n: number; title: string; right?: React.ReactNode; state: "done" | "warn" | "cur" | "next"; children?: React.ReactNode;
}) {
  const dot =
    state === "cur" ? "bg-[#1f3a5f] text-white" : state === "done" ? "bg-emerald-100 text-emerald-700" : state === "warn" ? "bg-amber-100 text-amber-800" : "bg-slate-100 text-slate-400";
  return (
    <div className="relative pb-4 pl-8 last:pb-0">
      <div className="absolute bottom-0 left-[9px] top-5 w-0.5 bg-slate-200 last:hidden" />
      <div className={`absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold ${dot}`}>
        {state === "done" ? "✓" : n}
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={`font-bold ${state === "next" ? "text-slate-400" : "text-slate-800"}`}>{title}</span>
        <span className="text-sm tabular-nums text-slate-600">{right}</span>
      </div>
      <div className={`mt-0.5 text-[12.5px] ${state === "next" ? "text-slate-400" : "text-slate-600"}`}>{children}</div>
    </div>
  );
}

// ── Registrar venda: 2 estágios (contrato / closing) ──────────────────────────────
function SaleForm({ h }: { h: HouseView }) {
  const sold = h.status === "SOLD";
  const [stage, setStage] = useState<"CONTRACT" | "CLOSING">(h.status === "UNDER_CONTRACT" || sold ? "CLOSING" : "CONTRACT");
  const [state, action, pending] = useActionState<FormState, FormData>(registerSale.bind(null, h.id), undefined);
  const [sale, setSale] = useState(h.actual.sale != null ? String(h.actual.sale) : "");
  const [net, setNet] = useState(h.actual.net != null ? String(h.actual.net) : "");
  const [payoff, setPayoff] = useState(h.actual.payoff != null ? String(h.actual.payoff) : h.loanInfo?.paidOff || !h.loanId ? "0" : "");
  const vSale = p(sale), vNet = p(net), vPayoff = p(payoff) ?? 0;
  const closing = vSale != null && vNet != null ? vSale - vPayoff - vNet : null;
  const cost = (h.actual.lot ?? 0) + (h.actual.build ?? 0) + h.coTotal;
  const profit = vSale != null && closing != null ? vSale - closing - cost : null;
  const tab = (k: "CONTRACT" | "CLOSING", l: string) => (
    <button
      type="button"
      onClick={() => setStage(k)}
      className={`rounded-lg border px-3 py-1 text-xs font-semibold ${stage === k ? "border-[#1f3a5f] bg-[#1f3a5f] text-white" : "border-slate-300 bg-white text-slate-600"}`}
    >
      {l}
    </button>
  );
  return (
    <form action={action} className="mt-2 rounded-xl border-[1.5px] border-[#1f3a5f] bg-[#f8fbff] px-4 py-3">
      <input type="hidden" name="stage" value={stage} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-bold uppercase tracking-wider text-[#1f3a5f]">{sold ? "Venda registrada — ajustar" : "Registrar venda"}</span>
        <div className="flex gap-1.5">{tab("CONTRACT", "1 · Sob contrato")}{tab("CLOSING", "2 · Closing")}</div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        {stage === "CONTRACT" && (
          <div>
            <label className={labelClass}>Data do contrato</label>
            <input type="date" name="contractDate" defaultValue={h.dates.contractDate} required className={inputClass} />
          </div>
        )}
        <div>
          <label className={labelClass}>Preço de venda</label>
          <input name="soldPrice" value={sale} onChange={(e) => setSale(e.target.value)} inputMode="decimal" placeholder={h.planned.sale != null ? `previsto ${fmt2(h.planned.sale)}` : ""} required className={inputClass} />
        </div>
        {stage === "CLOSING" && (
          <>
            <div>
              <label className={labelClass}>Data do closing</label>
              <input type="date" name="saleDate" defaultValue={h.dates.saleDate} required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Líquido recebido em conta</label>
              <input name="netReceived" value={net} onChange={(e) => setNet(e.target.value)} inputMode="decimal" placeholder="valor do wire" required className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Payoff ao banco</label>
              <input name="payoffAmount" value={payoff} onChange={(e) => setPayoff(e.target.value)} inputMode="decimal" className={inputClass} />
              <div className="mt-0.5 text-[11px] text-slate-400">
                {!h.loanId ? "Casa 100% equity — sem payoff." : h.loanInfo?.paidOff ? `Sugerido $0: o loan ${h.loanInfo.label} já está quitado.` : "Lançado no loan da casa (com reconveyance do banco, se houver)."}
              </div>
            </div>
          </>
        )}
      </div>
      {stage === "CLOSING" && (
        <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px]">
          <div className="flex justify-between py-0.5">
            <span>Closing cost <span className="text-slate-400">(venda − payoff − recebido{h.planned.closing != null ? ` · prev. ${fmt2(h.planned.closing)}` : ""})</span></span>
            <b className="tabular-nums">{closing != null ? "$" + fmt2(closing) : "—"}</b>
          </div>
          <div className="flex justify-between py-0.5">
            <span>Lucro da casa <span className="text-slate-400">(venda − closing − lote − obra{h.coTotal ? " − COs" : ""})</span></span>
            <b className={`tabular-nums ${profit == null ? "" : profit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{profit != null ? (profit < 0 ? "−$" : "$") + fmt2(Math.abs(profit)) : "—"}</b>
          </div>
          <div className="flex justify-between py-0.5">
            <span>Entra no caixa do pool</span>
            <b className="tabular-nums">{vNet != null ? "+$" + fmt2(vNet) : "—"}</b>
          </div>
        </div>
      )}
      <ul className="mt-2 space-y-0.5 text-[12px] text-slate-500">
        {stage === "CONTRACT" ? (
          <li>→ Status da casa vira <b>Sob contrato</b></li>
        ) : (
          <>
            <li>→ Status vira <b>Vendida</b>; com todas vendidas, o pool passa para <b>Closing</b></li>
            <li>→ Lança payoff e reconveyance no loan, se houver payoff</li>
            <li>→ Líquido entra no extrato da casa e no caixa do pool</li>
          </>
        )}
      </ul>
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={pending} className={btnClass}>
          {pending ? "Salvando…" : stage === "CONTRACT" ? "Salvar contrato" : sold ? "Salvar ajustes" : "Registrar venda"}
        </button>
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
        {state?.ok && !state.error && <span className="text-sm font-medium text-emerald-700">Salvo ✓</span>}
        {sold && (
          <Link href={h.distributionsHref} className="ml-auto text-xs font-semibold text-[#1f3a5f] underline">
            Distribuir aos sócios →
          </Link>
        )}
      </div>
    </form>
  );
}

// ── Lançar no extrato da casa ─────────────────────────────────────────────────
function CashForm({ houseId, onDone }: { houseId: string; onDone: () => void }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    async (prev: FormState, fd: FormData) => {
      const r = await addHouseCashEntry(houseId, prev, fd);
      if (r?.ok) onDone();
      return r;
    },
    undefined,
  );
  return (
    <form action={action} className="mt-3 rounded-lg border border-blue-100 bg-slate-50 p-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className={labelClass}>O que aconteceu</label>
          <select name="category" defaultValue="BUILD" className={inputClass}>
            {CASH_CATEGORIES.map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div>
          <label className={labelClass}>Data</label>
          <input type="date" name="date" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>Valor</label>
          <input name="amount" inputMode="decimal" placeholder="0.00" required className={inputClass} />
        </div>
        <div className="col-span-2">
          <label className={labelClass}>Memo</label>
          <input name="memo" placeholder="opcional" className={inputClass} />
        </div>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={pending} className={btnClass}>{pending ? "Lançando…" : "Lançar"}</button>
        {state?.error && <span className="text-sm text-red-600">{state.error}</span>}
      </div>
    </form>
  );
}

// form pequena por etapa — grava só os campos que manda (patchHouse)
function PatchForm({ houseId, children, label = "Salvar" }: { houseId: string; children: React.ReactNode; label?: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(patchHouse.bind(null, houseId), undefined);
  return (
    <form action={action}>
      {children}
      <div className="mt-3 flex items-center gap-3">
        <button type="submit" disabled={pending} className={ghostClass}>{pending ? "Salvando…" : label}</button>
        {state?.error && <span className="text-xs text-red-600">{state.error}</span>}
        {state?.ok && !state.error && <span className="text-xs font-medium text-emerald-700">Salvo ✓</span>}
      </div>
    </form>
  );
}

export function PoolHouseTimeline({
  h, milestones, changeOrders, dangerZone,
}: {
  h: HouseView;
  milestones: React.ReactNode;
  changeOrders: React.ReactNode;
  dangerZone: React.ReactNode;
}) {
  const [showCash, setShowCash] = useState(false);
  const d = h.dates;
  const statusIdx = STATUSES.findIndex(([v]) => v === h.status);

  // etapa atual deriva do STATUS (fato); as anteriores ficam ✓ ou âmbar (data faltando)
  const cur =
    h.status === "PLANNED" ? 0
    : h.status === "LOT_PURCHASED" ? 1
    : h.status === "UNDER_CONSTRUCTION" ? 3
    : h.status === "FOR_SALE" ? (d.coDate ? 5 : 4)
    : 6;
  const missing: Record<number, boolean> = {
    0: !d.lotContractDate || !d.lotPaidDate,
    1: !d.permitAppliedDate || !d.permitIssuedDate,
    2: !h.loanId && h.actual.ownCapital == null,
    3: !d.buildStartDate,
    4: !d.coDate,
    5: !d.listedDate,
    6: !d.contractDate || !d.saleDate,
  };
  const st = (i: number): "done" | "warn" | "cur" | "next" =>
    i === cur && h.status !== "SOLD" ? "cur" : i > cur ? "next" : missing[i] ? "warn" : "done";
  const pendingDates = (Object.keys(d) as Array<keyof HouseDates>).filter((k) => !d[k]).length;

  const plCost = h.planned.lot == null && h.planned.build == null ? null : (h.planned.lot ?? 0) + (h.planned.build ?? 0) + (h.planned.closing ?? 0);
  const plProfit = h.planned.sale == null || plCost == null ? null : h.planned.sale - plCost;
  const hasActualCost = h.actual.lot != null || h.actual.build != null;
  const aProfit =
    h.actual.sale == null || !hasActualCost ? null
    : h.actual.sale - (h.actual.closing ?? 0) - (h.actual.lot ?? 0) - (h.actual.build ?? 0) - h.coTotal;
  const costReal = hasActualCost ? (h.actual.lot ?? 0) + (h.actual.build ?? 0) : null;
  const loanAmount = p(h.bank.bankLoanAmount);

  const srcPill = (s: LedgerRow["source"]) =>
    s === "BANK" ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10.5px] font-semibold text-[#1f3a5f]">Banco</span>
    : s === "SALE" ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">Venda</span>
    : s === "POOL" ? <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] font-semibold text-slate-600">Pool</span>
    : null;

  return (
    <div className="space-y-3">
      {/* 1. cabeçalho + stepper derivado */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <Link href={`/pools/${h.poolId}?tab=houses`} className="text-xs text-slate-500 hover:text-slate-700">← {h.crumb}</Link>
        <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-semibold text-slate-800">{h.address}</h1>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-600">
                {h.modelName && h.locationName ? `${h.modelName} · ${h.locationName}` : "modelo/localização a definir"}
              </span>
              {h.loanInfo ? (
                <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[11px] font-semibold text-[#1f3a5f]">
                  🏦 {h.loanInfo.label}{loanAmount != null ? ` · ${usd(loanAmount)}` : ""}
                </span>
              ) : (
                <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-500">100% equity</span>
              )}
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${pendingDates ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
                {pendingDates ? `${pendingDates} ${pendingDates === 1 ? "data pendente" : "datas pendentes"}` : "datas completas"}
              </span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-slate-400">Lucro previsto → real</div>
            <div className="text-2xl font-extrabold tabular-nums">
              <span className="text-slate-400">{plProfit != null ? usd(plProfit) : "—"}</span>
              <span className="text-slate-300"> → </span>
              <span className={aProfit == null ? "text-slate-300" : aProfit >= 0 ? "text-emerald-700" : "text-red-700"}>{aProfit != null ? usd(aProfit) : "—"}</span>
            </div>
          </div>
        </div>
        <div className="mt-3 flex gap-1" title="Fases derivadas dos fatos: lote pago, draws/início da obra, CO, contrato de venda, venda.">
          {STATUSES.map(([v, l], i) => (
            <div
              key={v}
              className={`flex-1 rounded-md px-1 py-1.5 text-center text-[10.5px] ${
                i === statusIdx ? "bg-[#1f3a5f] font-bold text-white" : i < statusIdx ? "bg-emerald-100 font-semibold text-emerald-700" : "bg-slate-100 text-slate-400"
              }`}
            >
              {l}{v === "UNDER_CONSTRUCTION" && statusIdx === i && h.buildPct != null && <b> · {h.buildPct}%</b>}
            </div>
          ))}
        </div>
      </section>

      {/* 2. KPIs */}
      <section className="grid grid-cols-2 gap-2 md:grid-cols-5">
        <Kpi label="Custo real" value={costReal != null ? usd(costReal) : "—"} sub={`lote + obra${plCost != null ? ` · previsto ${usd((h.planned.lot ?? 0) + (h.planned.build ?? 0))}` : ""}`} />
        <Kpi label="Banco sacado" value={usd(h.drawn)} sub={loanAmount ? `${Math.min(100, Math.round((h.drawn / loanAmount) * 100))}% do loan · ${h.draws.filter((x) => !x.pending).length} draws` : h.loanId ? "loan sem valor" : "sem loan"} />
        <Kpi label="Capital próprio" value={h.actual.ownCapital != null ? usd(h.actual.ownCapital) : "—"} sub="soma do extrato · não digitado" />
        <Kpi label="Venda" value={h.actual.sale != null ? usd(h.actual.sale) : "—"} sub={h.planned.sale != null ? `prevista ${usd(h.planned.sale)}` : undefined} />
        <Kpi label="Caixa para o pool" value={h.actual.net != null ? usd(h.actual.net) : "—"} sub="líquido recebido na venda" />
      </section>

      <div className="grid gap-3 lg:grid-cols-2">
        {/* 3. vida da casa */}
        <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Vida da casa</h2>
          <p className="text-[11.5px] text-slate-400">Cada etapa guarda data, valor e ação num só lugar. Clique no chip para carimbar a data.</p>
          <div className="mt-3">
            <Stage n={1} title="Lote" state={st(0)} right={<>{h.actual.lot != null ? "$" + fmt2(h.actual.lot) : "—"} {h.planned.lot != null && <span className="text-slate-400">prev. {usd(h.planned.lot)}</span>}</>}>
              <DateChip houseId={h.id} field="lotContractDate" label="contrato" value={d.lotContractDate} />
              <DateChip houseId={h.id} field="lotPaidDate" label="pago" value={d.lotPaidDate} />
              {h.actual.lot == null && <div className="mt-1 text-[11px] text-slate-400">Custo do lote entra pelo extrato (“+ Lançar · Paguei o lote”).</div>}
            </Stage>
            <Stage n={2} title="Permit" state={st(1)}>
              <DateChip houseId={h.id} field="permitAppliedDate" label="aplicado" value={d.permitAppliedDate} />
              <DateChip houseId={h.id} field="permitIssuedDate" label="emitido" value={d.permitIssuedDate} />
            </Stage>
            <Stage n={3} title="Funding" state={st(2)} right={loanAmount != null ? <>{usd(loanAmount)} <span className="text-slate-400">loan aprovado</span></> : h.loanId ? "" : "100% equity"}>
              {h.loanInfo && (
                <div>
                  {h.loanInfo.label}{h.loanInfo.closingDate ? ` · closing do loan em ${br(h.loanInfo.closingDate)}` : ""}{h.loanInfo.apr != null ? ` · ${h.loanInfo.apr}% a.a.` : ""}
                  <br />
                  <span className="text-slate-400">
                    {h.loanInfo.paidOff ? `Loan quitado (saldo ${usd(h.loanInfo.balance)}).` : `Saldo do loan: ${usd(h.loanInfo.balance)}.`}{" "}
                    <Link href={h.loanHref} className="underline hover:text-slate-600">Loan statement</Link>
                  </span>
                </div>
              )}
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">✎ loan, condições do banco e acesso à obra</summary>
                <div className="mt-2">
                  <PatchForm houseId={h.id}>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className={labelClass}>Loan da casa</label>
                        <select name="loanId" defaultValue={h.loanId} className={inputClass}>
                          <option value="">— (100% equity)</option>
                          {h.loans.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                        </select>
                      </div>
                      {([
                        ["bankName", "Bank"], ["bankLoanAmount", "Original loan"], ["bankOriginationFee", "Origination fee"],
                        ["bankInterestReserve", "Interest reserve"], ["bankCashToClose", "Cash to close"],
                        ["bankBudgetReviewFee", "Budget review fee"], ["bankCharges", "Bank charges"],
                      ] as Array<[keyof HouseView["bank"], string]>).map(([f, l]) => (
                        <div key={f}><label className={labelClass}>{l}</label><input name={f} defaultValue={h.bank[f]} className={inputClass} /></div>
                      ))}
                      <div><label className={labelClass}>Pin location</label><input name="pinLocation" defaultValue={h.pinLocation} placeholder="https://maps.google.com/?q=…" className={inputClass} /></div>
                      <div><label className={labelClass}>Lockbox code</label><input name="lockboxCode" defaultValue={h.lockboxCode} className={inputClass} /></div>
                    </div>
                  </PatchForm>
                </div>
              </details>
            </Stage>
            <Stage n={4} title="Obra" state={st(3)} right={<>{h.actual.build != null ? "$" + fmt2(h.actual.build) : "—"} {h.planned.build != null && <span className="text-slate-400">prev. {usd(h.planned.build)}</span>}</>}>
              <div>
                Draws: {h.draws.filter((x) => !x.pending).length ? h.draws.filter((x) => !x.pending).map((x) => `${br(x.date)} ${usd(x.amount)}`).join(" · ") : "nenhum"}
                {loanAmount ? <> = <b>{Math.min(100, Math.round((h.drawn / loanAmount) * 100))}% do loan</b></> : null}
                <br />
                Fases: {h.milestonesDone} de {h.milestonesTotal} marcadas · Change orders: {h.coCount ? `${h.coCount} (${(h.coTotal >= 0 ? "+" : "−") + usd(Math.abs(h.coTotal))})` : "nenhum"}
              </div>
              <DateChip houseId={h.id} field="buildStartDate" label="início da obra" value={d.buildStartDate} />
              <details className="mt-1.5" open={cur === 3}>
                <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">fases da obra e draws</summary>
                <div className="mt-2">{milestones}</div>
              </details>
              <details className="mt-1.5">
                <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">change orders {h.coCount ? `(${h.coCount})` : ""}</summary>
                <div className="mt-2">{changeOrders}</div>
              </details>
            </Stage>
            <Stage n={5} title="CO" state={st(4)} right={<span className="text-slate-400">Certificate of Occupancy</span>}>
              <DateChip houseId={h.id} field="coDate" label="data do CO" value={d.coDate} />
            </Stage>
            <Stage n={6} title="Mercado" state={st(5)} right={h.planned.sale != null ? <span className="text-slate-400">pedido prev. {usd(h.planned.sale)}</span> : null}>
              <DateChip houseId={h.id} field="listedDate" label="anunciada" value={d.listedDate} />
            </Stage>
            <Stage n={7} title="Venda" state={st(6)} right={h.status === "SOLD" ? <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">vendida</span> : cur === 6 ? <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-[#1f3a5f]">etapa atual</span> : null}>
              {h.status === "SOLD" && (
                <div className="mb-1">
                  Contrato {br(d.contractDate) || "—"} · closing {br(d.saleDate)} · venda {usd(h.actual.sale ?? 0)}
                  {h.actual.payoff ? ` · payoff ${usd(h.actual.payoff)}` : ""} · líquido {usd(h.actual.net ?? 0)}
                  {h.actual.closing != null ? ` · closing cost ${usd(h.actual.closing)}` : ""}
                </div>
              )}
              <DateChip houseId={h.id} field="contractDate" label="contrato" value={d.contractDate} />
              <DateChip houseId={h.id} field="saleDate" label="closing" value={d.saleDate} />
              {/* key pelo status: salvo o contrato, a form remonta já no estágio Closing */}
              {h.status === "SOLD" ? (
                <details className="mt-1.5">
                  <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">✎ ajustar valores da venda</summary>
                  <SaleForm key={h.status} h={h} />
                </details>
              ) : (
                <SaleForm key={h.status} h={h} />
              )}
            </Stage>
          </div>
        </section>

        {/* 4. extrato + planejado × real */}
        <div className="space-y-3">
          <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Extrato da casa</h2>
              <button type="button" onClick={() => setShowCash((v) => !v)} className={ghostClass}>{showCash ? "fechar" : "+ Lançar"}</button>
            </div>
            <p className="text-[11.5px] text-slate-400">O que entrou na casa (pool, banco, venda) e o que saiu dela. É um filtro do extrato do pool.</p>
            {showCash && <CashForm houseId={h.id} onDone={() => setShowCash(false)} />}
            <table className="mt-2 w-full">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10.5px] uppercase tracking-wider text-slate-400">
                  <th className="py-1.5 pr-2 font-medium">Data</th>
                  <th className="py-1.5 pr-2 font-medium">Lançamento</th>
                  <th className="py-1.5 pr-2 font-medium"></th>
                  <th className="py-1.5 pr-2 text-right font-medium">Entrou</th>
                  <th className="py-1.5 text-right font-medium">Saiu</th>
                  <th className="w-5"></th>
                </tr>
              </thead>
              <tbody className="text-[13px]">
                {h.ledger.rows.length === 0 && (
                  <tr><td colSpan={6} className="py-4 text-center text-slate-400">Nada lançado ainda — comece pela partida do pool (“Pool colocou capital próprio”).</td></tr>
                )}
                {h.ledger.rows.map((r, i) => (
                  <tr key={r.id ?? `d${i}`} className="border-b border-slate-50">
                    <td className="whitespace-nowrap py-1.5 pr-2 text-slate-500">{r.date ? br(r.date) : <span className="text-slate-400">abertura</span>}</td>
                    {/* memo de abertura é só explicação — fica no tooltip p/ não engordar a linha */}
                    <td className="py-1.5 pr-2 text-slate-700" title={r.memo ?? undefined}>
                      {r.label}{r.memo && r.date && <span className="text-slate-400"> · {r.memo}</span>}
                    </td>
                    <td className="py-1.5 pr-2">{srcPill(r.source)}</td>
                    <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">{r.inAmount != null ? fmt2(r.inAmount) : ""}</td>
                    <td className="whitespace-nowrap py-1.5 text-right tabular-nums">{r.outAmount != null ? fmt2(r.outAmount) : ""}</td>
                    <td className="py-1.5 text-right">
                      {r.id && (
                        <form action={deleteHouseCashEntry}>
                          <input type="hidden" name="entryId" value={r.id} />
                          <button type="submit" title="Apagar lançamento" className="text-xs text-slate-300 hover:text-red-500">✕</button>
                        </form>
                      )}
                    </td>
                  </tr>
                ))}
                {h.ledger.rows.length > 0 && (
                  <>
                    <tr className="bg-slate-50 font-bold">
                      <td colSpan={3} className="py-2 pr-2">Totais</td>
                      <td className="py-2 pr-2 text-right tabular-nums">{fmt2(h.ledger.totalIn)}</td>
                      <td className="py-2 text-right tabular-nums">{fmt2(h.ledger.totalOut)}</td>
                      <td></td>
                    </tr>
                    <tr className="bg-slate-50 font-bold">
                      <td colSpan={3} className="py-2 pr-2">
                        Saldo parado na casa{" "}
                        {Math.abs(h.ledger.balance) >= 0.01 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800">a conferir</span>}
                      </td>
                      <td colSpan={2} className={`py-2 text-right tabular-nums ${h.ledger.balance > 0.01 ? "text-emerald-700" : h.ledger.balance < -0.01 ? "text-red-700" : ""}`}>
                        {(h.ledger.balance < 0 ? "−" : h.ledger.balance > 0 ? "+" : "") + fmt2(Math.abs(h.ledger.balance))}
                      </td>
                      <td></td>
                    </tr>
                    {h.ledger.saleIn > 0 && (
                      <tr className="bg-emerald-50 font-bold">
                        <td colSpan={3} className="py-2 pr-2">↩ Voltou ao caixa do pool no closing</td>
                        <td colSpan={2} className="py-2 text-right tabular-nums text-emerald-700">{fmt2(h.ledger.saleIn + Math.max(0, h.ledger.balance))}</td>
                        <td></td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-400">
              “Abertura” = valores da ficha antiga, sem data. Saldo positivo é dinheiro que entrou e não foi gasto: ou é custo ainda não lançado, ou é excedente a devolver ao caixa do pool. Negativo = custo pago sem a entrada correspondente lançada.
            </p>
            {h.ledger.balance > 0.01 && (
              <form action={returnExcessToPool} className="mt-2">
                <input type="hidden" name="houseId" value={h.id} />
                <input type="hidden" name="amount" value={h.ledger.balance} />
                <button type="submit" className={ghostClass}>↩ Devolver excedente de ${fmt2(h.ledger.balance)} ao caixa do pool</button>
              </form>
            )}
          </section>

          <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Planejado × real</h2>
            <table className="mt-2 w-full">
              <thead>
                <tr className="border-b border-slate-200 text-left text-[10.5px] uppercase tracking-wider text-slate-400">
                  <th className="py-1.5 pr-2 font-medium"></th>
                  <th className="py-1.5 pr-2 text-right font-medium">Planejado</th>
                  <th className="py-1.5 pr-2 text-right font-medium">Real</th>
                  <th className="py-1.5 text-right font-medium">Δ</th>
                </tr>
              </thead>
              <tbody className="text-[13px]">
                {([
                  ["Lote", h.planned.lot, h.actual.lot, true],
                  ["Obra", h.planned.build, h.actual.build, true],
                  ["Venda", h.planned.sale, h.actual.sale, false],
                  ["Closing da venda", h.planned.closing, h.actual.closing, true],
                ] as Array<[string, number | null, number | null, boolean]>).map(([l, plan, real, costRow]) => (
                  <tr key={l} className="border-b border-slate-50">
                    <td className="py-1.5 pr-2 font-semibold text-slate-700">{l}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-slate-500">{plan != null ? fmt2(plan) : "—"}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums text-slate-800">{real != null ? fmt2(real) : "—"}</td>
                    <td className="py-1.5 text-right"><Delta value={plan != null && real != null ? real - plan : null} goodWhenNegative={costRow} /></td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-bold">
                  <td className="py-2 pr-2 text-slate-800">Lucro</td>
                  <td className="py-2 pr-2 text-right tabular-nums text-slate-700">{plProfit != null ? fmt2(plProfit) : "—"}</td>
                  <td className={`py-2 pr-2 text-right tabular-nums ${aProfit == null ? "" : aProfit >= 0 ? "text-emerald-700" : "text-red-700"}`}>{aProfit != null ? fmt2(aProfit) : "—"}</td>
                  <td className="py-2 text-right"><Delta value={plProfit != null && aProfit != null ? aProfit - plProfit : null} goodWhenNegative={false} /></td>
                </tr>
              </tbody>
            </table>
            <p className="mt-2 text-[11px] text-slate-400">Lucro por custo da casa{h.coTotal ? " (inclui change orders)" : ""}. Juros e taxas do loan são do pool.</p>
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-slate-400 hover:text-slate-600">De onde vem o planejado? (ajustar pro forma)</summary>
              <p className="mt-2 text-[11px] text-slate-400">Veio da simulação de origem na conversão do pool. Ajuste só se a premissa da casa mudou de fato.</p>
              <div className="mt-2">
                <PatchForm houseId={h.id}>
                  <div className="grid grid-cols-2 gap-3">
                    {([
                      ["plannedLotCost", "Lote (plan.)", h.planned.lot], ["plannedBuildCost", "Obra (plan.)", h.planned.build],
                      ["plannedSalePrice", "Venda (plan.)", h.planned.sale], ["plannedClosingCost", "Closing (plan.)", h.planned.closing],
                    ] as Array<[string, string, number | null]>).map(([f, l, v]) => (
                      <div key={f}><label className={labelClass}>{l}</label><input name={f} defaultValue={v != null ? String(v) : ""} className={inputClass} /></div>
                    ))}
                  </div>
                </PatchForm>
              </div>
            </details>
          </section>
        </div>
      </div>

      {/* 5. identidade, notas e zona de perigo */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <details>
          <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">⋯ Endereço, modelo, notas</summary>
          <div className="mt-3">
            <PatchForm houseId={h.id}>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="md:col-span-3"><label className={labelClass}>Endereço</label><input name="address" defaultValue={h.address} required className={inputClass} /></div>
                <div>
                  <label className={labelClass}>Localização</label>
                  <select name="catalogLocationId" defaultValue={h.catalogLocationId} className={inputClass}>
                    <option value="">—</option>
                    {h.catalog.locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={labelClass}>Modelo (simulador)</label>
                  <select name="catalogModelId" defaultValue={h.catalogModelId} className={inputClass}>
                    <option value="">—</option>
                    {h.catalog.modelLocations
                      .filter((ml) => !h.catalogLocationId || ml.locationId === h.catalogLocationId)
                      .map((ml) => <option key={`${ml.locationId}|${ml.modelId}`} value={ml.modelId}>{ml.modelName}</option>)}
                  </select>
                </div>
                <div className="md:col-span-3"><label className={labelClass}>Notas</label><textarea name="notes" rows={2} defaultValue={h.notes} className={inputClass} /></div>
              </div>
            </PatchForm>
          </div>
        </details>
        {dangerZone}
      </section>
    </div>
  );
}
