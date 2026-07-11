import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import {
  convertSimulationToPool,
  deleteSimulation,
  rerunSimulation,
  useComparedBank,
} from "@/lib/actions/simulations";
import { simulate, type SimResult } from "@/lib/pools/simulator";
import { buildSimInput, type PromoteTierInput, type UnitRef } from "@/lib/pools/build-sim-input";
import { SimulationControls } from "@/components/simulation-controls";
import { BankMultiSelect } from "@/components/bank-multiselect";
import { BankLoiUpload } from "@/components/bank-loi-upload";
import { SimLedger, type LedgerRow } from "@/components/sim-ledger";

export const dynamic = "force-dynamic";

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-1.5 text-sm text-slate-600";
const tdRight = "px-3 py-1.5 text-right text-sm tabular-nums text-slate-700";

const KIND_LABEL: Record<string, string> = {
  INJECTION: "Aporte",
  RETURN: "Retorno",
  LOT: "Lote",
  PHASE: "Obra",
  CONTINGENCY: "Contingência",
  SALE: "Venda",
  PERF_FEE: "Performance 4U",
  BANK_DRAW: "Draw banco",
  BANK_CTC: "Cash to closing",
  BANK_FEE: "Fee banco",
  BANK_RESERVE: "Reserve",
  BANK_INTEREST: "Juros banco",
  BANK_PAYOFF: "Payoff banco",
};

function Card({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

function fmtDuration(days: number): string {
  const y = Math.floor(days / 365);
  const m = Math.floor((days % 365) / 30);
  const d = Math.round((days % 365) % 30);
  return [y ? `${y}y` : null, m ? `${m}m` : null, `${d}d`].filter(Boolean).join(" ");
}

type CompareRow = {
  bankId: string;
  bankName: string;
  irr: number | null;
  profit: number;
  peak: number;
  bankCost: number;
  ctc?: number;
  best?: boolean;
};

// Fluxo do investidor na linha do tempo: verde p/ cima = retorno, vermelho p/ baixo =
// aporte. SVG com largura 100% — comprime para caber sempre na tela, sem rolagem.
function CashflowChart({
  monthly,
}: {
  monthly: Array<{ month: number; inflow: number; outflow: number }>;
}) {
  if (monthly.length === 0) return null;
  const months = Array.from({ length: Math.max(...monthly.map((m) => m.month)) }, (_, i) => {
    const m = monthly.find((x) => x.month === i + 1);
    return { month: i + 1, aporte: m?.inflow ?? 0, retorno: m?.outflow ?? 0 };
  });
  const maxUp = Math.max(...months.map((m) => m.retorno), 1);
  const maxDown = Math.max(...months.map((m) => m.aporte), 1);
  const W = 720;
  const H = 190;
  const upH = 120;
  const downH = 50;
  const zeroY = 10 + upH;
  const slot = W / months.length;
  const barW = Math.min(34, Math.max(4, slot * 0.62));
  const labelEvery = Math.ceil(months.length / 16);
  const fmtK = (v: number) => (v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-medium text-slate-800">Fluxo do investidor na linha do tempo</h2>
        <p className="text-xs text-slate-400">
          Verde para cima = retorno ao investidor · vermelho para baixo = aporte. Valores em $ mil.
        </p>
      </div>
      <div className="px-5 py-4">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Fluxo mensal do investidor">
          <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="#cbd5e1" strokeWidth="1" />
          {months.map((m, i) => {
            const x = i * slot + (slot - barW) / 2;
            const hUp = (m.retorno / maxUp) * upH;
            const hDown = (m.aporte / maxDown) * downH;
            return (
              <g key={m.month}>
                {m.retorno > 0 && (
                  <>
                    <rect x={x} y={zeroY - hUp} width={barW} height={hUp} fill="#10b981" rx="2" />
                    {hUp > 14 && barW >= 16 && (
                      <text x={x + barW / 2} y={zeroY - hUp - 3} textAnchor="middle" fontSize="9" fill="#047857">
                        {fmtK(m.retorno)}
                      </text>
                    )}
                  </>
                )}
                {m.aporte > 0 && (
                  <>
                    <rect x={x} y={zeroY} width={barW} height={hDown} fill="#ef4444" rx="2" />
                    {hDown > 12 && barW >= 16 && (
                      <text x={x + barW / 2} y={zeroY + hDown + 10} textAnchor="middle" fontSize="9" fill="#b91c1c">
                        {fmtK(m.aporte)}
                      </text>
                    )}
                  </>
                )}
                {(i + 1) % labelEvery === 0 && (
                  <text x={x + barW / 2} y={H - 2} textAnchor="middle" fontSize="9" fill="#94a3b8">
                    M{m.month}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </section>
  );
}

// Quadro mensal dos custos do banco (juros, closing, taxas de draw e payoff, extensão),
// com somatória no rodapé CONFERIDA contra os KPIs do motor — sem faltar um centavo.
function BankCostsMonthly({
  events,
  kpis,
  isBank,
}: {
  events: SimResult["events"];
  kpis: SimResult["kpis"];
  isBank: boolean;
}) {
  if (!isBank) return null;
  const CATS = ["INTEREST", "CLOSING", "DRAW_FEES", "PAYOFF_FEES", "EXTENSION"] as const;
  const byMonth = new Map<number, Record<string, number>>();
  for (const e of events) {
    if (!e.bankCat || e.bankCat === "RESERVE") continue;
    const m = Math.floor(e.day / 30) + 1;
    const row = byMonth.get(m) ?? {};
    const v = e.infoAmount ?? Math.abs(e.bankAmount ?? e.amount);
    row[e.bankCat] = (row[e.bankCat] ?? 0) + v;
    byMonth.set(m, row);
  }
  const months = [...byMonth.keys()].sort((a, b) => a - b);
  const r2 = (v: number) => Math.round(v * 100) / 100;
  const tot = (cat: string) => r2(months.reduce((s, m) => s + (byMonth.get(m)![cat] ?? 0), 0));
  const totals = Object.fromEntries(CATS.map((c) => [c, tot(c)]));
  const grand = r2(CATS.reduce((s, c) => s + totals[c], 0));
  const expected = r2(
    kpis.bankInterestTotal + kpis.bankUpfrontFees + (kpis.bankOtherFees ?? 0) + kpis.bankExtensionFee,
  );
  const bate =
    Math.abs(totals.INTEREST - kpis.bankInterestTotal) <= 0.01 &&
    Math.abs(totals.CLOSING - kpis.bankUpfrontFees) <= 0.01 &&
    Math.abs(totals.DRAW_FEES + totals.PAYOFF_FEES - (kpis.bankOtherFees ?? 0)) <= 0.01 &&
    Math.abs(totals.EXTENSION - kpis.bankExtensionFee) <= 0.01;
  const money = (v: number) =>
    v ? `$${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}` : "—";
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-medium text-slate-800">Custos do banco por mês</h2>
          <p className="text-xs text-slate-400">
            Juros, closing, taxas de draw/payoff e extensão — somatória conferida contra o motor.
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            bate ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
          }`}
        >
          {bate ? "✓ bate com o calculado" : `✗ difere do calculado (${money(r2(grand - expected))})`}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className={th}>Mês</th>
              <th className={thRight}>Juros + mensais</th>
              <th className={thRight}>Closing</th>
              <th className={thRight}>Taxas de draw</th>
              <th className={thRight}>Taxas de payoff</th>
              <th className={thRight}>Extensão</th>
              <th className={thRight}>Total</th>
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const row = byMonth.get(m)!;
              const rowTotal = r2(CATS.reduce((s, c) => s + (row[c] ?? 0), 0));
              return (
                <tr key={m} className="border-b border-slate-50">
                  <td className={td}>M{m}</td>
                  <td className={tdRight}>{money(r2(row.INTEREST ?? 0))}</td>
                  <td className={tdRight}>{money(r2(row.CLOSING ?? 0))}</td>
                  <td className={tdRight}>{money(r2(row.DRAW_FEES ?? 0))}</td>
                  <td className={tdRight}>{money(r2(row.PAYOFF_FEES ?? 0))}</td>
                  <td className={tdRight}>{money(r2(row.EXTENSION ?? 0))}</td>
                  <td className={`${tdRight} font-medium`}>{money(rowTotal)}</td>
                </tr>
              );
            })}
            <tr className="bg-slate-50/60">
              <td className={`${td} font-semibold text-slate-800`}>Total</td>
              <td className={`${tdRight} font-semibold`}>{money(totals.INTEREST)}</td>
              <td className={`${tdRight} font-semibold`}>{money(totals.CLOSING)}</td>
              <td className={`${tdRight} font-semibold`}>{money(totals.DRAW_FEES)}</td>
              <td className={`${tdRight} font-semibold`}>{money(totals.PAYOFF_FEES)}</td>
              <td className={`${tdRight} font-semibold`}>{money(totals.EXTENSION)}</td>
              <td className={`${tdRight} font-semibold`}>{money(grand)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

const TABS = [
  ["dash", "Dashboard"],
  ["setup", "Setup"],
  ["casas", "Casas"],
  ["financeiro", "Financeiro"],
  ["loan", "Cálculos do loan"],
  ["ledger", "Ledger"],
] as const;

export default async function SimulationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const { id } = await params;
  const { tab: rawTab } = await searchParams;
  const tab = TABS.some(([t]) => t === rawTab) ? (rawTab as string) : "dash";
  const sim = await prisma.poolSimulation.findUnique({
    where: { id },
    include: { scenario: true, bankProfile: true, pool: true },
  });
  if (!sim) notFound();
  const r = sim.result as unknown as (SimResult & { comparison?: CompareRow[] }) | null;
  const comparison = r?.comparison ?? null;
  const isBank = sim.fundingMode === "BANK";
  // dias que precisaram de aporte — usado p/ marcar contas pagas do caixa (verde)
  const injectionDays = new Set(
    (r?.events ?? []).filter((e) => e.kind === "INJECTION").map((e) => e.day),
  );
  const [allBanks, allScenarios] = await Promise.all([
    prisma.bankProfile.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        lois: { orderBy: { createdAt: "desc" }, take: 1, select: { loiNumber: true, loiDate: true } },
      },
    }),
    prisma.bufferScenario.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
  ]);
  const bankOptions = allBanks.map((b) => ({
    id: b.id,
    name: b.name,
    loi: b.lois[0]
      ? `LOI${b.lois[0].loiNumber ? ` ${b.lois[0].loiNumber}` : ""}${b.lois[0].loiDate ? ` · ${b.lois[0].loiDate.toISOString().slice(0, 10)}` : ""}`
      : null,
  }));

  // Mini-comparativo: a MESMA simulação nos 3 cenários (sempre fresco do catálogo)
  const simFieldsBase = {
    fundingMode: sim.fundingMode,
    upfrontFunding: sim.upfrontFunding,
    compMode: sim.compMode,
    perfPct: sim.perfPct,
    perfTiming: sim.perfTiming,
    promoteTiers: (sim.promoteTiers as PromoteTierInput[] | null) ?? null,
    flatFeePerHouse: sim.flatFeePerHouse,
    paymentPlan: sim.paymentPlan,
    equityGatePct: sim.equityGatePct,
    parallelPermit: sim.parallelPermit,
    unitGapDays: sim.unitGapDays,
    bankProfileId: sim.bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
  };
  const scenarioCards = await Promise.all(
    allScenarios.map(async (s) => {
      const input = await buildSimInput({ ...simFieldsBase, scenarioCode: s.code });
      if ("error" in input) return { code: s.code, name: s.name, kpis: null };
      const res = simulate(input);
      return {
        code: s.code,
        name: s.name,
        kpis: { irr: res.kpis.irrAnnual, profit: res.kpis.profit, peak: res.kpis.peakCapital },
      };
    }),
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/pools/simulator" className="text-sm text-slate-500 hover:text-slate-700">
            ← Simulator
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-800">{sim.name}</h1>
          <p className="text-sm text-slate-500">
            {sim.scenario.name} · {sim.fundingMode === "BANK" ? `bank: ${sim.bankProfile?.name}` : "equity"} ·{" "}
            {sim.compMode === "PERFORMANCE"
              ? `performance ${Number(sim.perfPct)}% (${sim.perfTiming === "PER_SALE" ? "por venda" : "na conclusão"})`
              : sim.compMode === "PROMOTE"
                ? "promote (waterfall)"
                : sim.compMode === "OPEN_BOOK"
                  ? `open book + flat ${formatMoney(Number(sim.flatFeePerHouse), "USD")}/casa${(sim.promoteTiers as unknown[] | null)?.length ? " + promote" : ""}`
                  : "contractor fee"}
            {" · "}
            {sim.paymentPlan === "LIGHT_START" ? "desembolso 10/15/25/25/20/5" : "desembolso 10/30/20/20/15/5"}
            {sim.pool ? ` · pool ${sim.pool.code}` : ""}
          </p>
        </div>
        <div className="flex gap-2">
          {sim.pool ? (
            <Link
              href={`/pools/${sim.pool.id}`}
              className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 hover:bg-emerald-100"
            >
              Pool criado: {sim.pool.code} →
            </Link>
          ) : (
            <form action={convertSimulationToPool}>
              <input type="hidden" name="simulationId" value={sim.id} />
              <button
                type="submit"
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
              >
                + Criar pool desta simulação
              </button>
            </form>
          )}
          <form action={rerunSimulation}>
            <input type="hidden" name="simulationId" value={sim.id} />
            <button
              type="submit"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              ⟳ Re-run with current catalog
            </button>
          </form>
          <form action={deleteSimulation}>
            <input type="hidden" name="simulationId" value={sim.id} />
            <button
              type="submit"
              className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-500 hover:bg-red-50"
            >
              Delete
            </button>
          </form>
        </div>
      </div>

      {/* Blocos viram ABAS para não rolar: Dashboard (números) · Setup (alavancas +
          comparador) · Casas · Ledger */}
      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/pools/simulator/${sim.id}?tab=${key}`}
            className={`rounded-t-lg border-b-2 px-4 py-2 text-sm transition ${
              tab === key
                ? "border-[#1f3a5f] font-medium text-[#1f3a5f]"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {/* Alavancas da simulação viva: cenário, funding e remuneração recalculam na hora.
          key = valores salvos → remonta após cada recálculo (o form reset do React 19
          dessincroniza selects controlados; a remontagem realinha a tela com o banco) */}
      {tab === "setup" && (
      <SimulationControls
        key={[
          sim.scenarioCode,
          sim.fundingMode,
          sim.bankProfileId ?? "",
          sim.compMode,
          Number(sim.perfPct),
          sim.perfTiming,
          Number(sim.flatFeePerHouse),
          sim.paymentPlan,
          String(sim.upfrontFunding),
          JSON.stringify(sim.promoteTiers ?? null),
        ].join("|")}
        sim={{
          id: sim.id,
          scenarioCode: sim.scenarioCode,
          fundingMode: sim.fundingMode,
          bankProfileId: sim.bankProfileId,
          compMode: sim.compMode,
          perfPct: Number(sim.perfPct).toString(),
          perfTiming: sim.perfTiming,
          flatFeePerHouse: Number(sim.flatFeePerHouse).toString(),
          paymentPlan: sim.paymentPlan,
          upfrontFunding: sim.upfrontFunding,
          promoteTiers:
            (sim.promoteTiers as Array<{ hurdlePct: number | null; promotePct: number }> | null) ??
            null,
        }}
        scenarios={allScenarios}
        banks={allBanks}
      />
      )}

      {/* A mesma simulação nos 3 cenários — o em exibição destacado */}
      {tab === "dash" && (
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {scenarioCards.map((s) => (
          <div
            key={s.code}
            className={`rounded-xl border bg-white p-4 ${
              s.code === sim.scenarioCode ? "border-2 border-[#1f3a5f]" : "border-slate-200"
            }`}
          >
            <div className={`text-xs ${s.code === sim.scenarioCode ? "font-medium text-[#1f3a5f]" : "text-slate-400"}`}>
              {s.name}
              {s.code === sim.scenarioCode ? " — em exibição" : ""}
            </div>
            {s.kpis ? (
              <>
                <div className="text-lg font-semibold tabular-nums text-slate-900">
                  {s.kpis.irr != null ? `TIR ${(s.kpis.irr * 100).toFixed(1)}%` : "TIR —"} ·{" "}
                  {formatMoney(s.kpis.profit, "USD")}
                </div>
                <div className="text-xs text-slate-400">pico {formatMoney(s.kpis.peak, "USD")}</div>
              </>
            ) : (
              <div className="text-sm text-slate-400">catálogo incompleto p/ este cenário</div>
            )}
          </div>
        ))}
      </div>
      )}

      {!r ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          No result stored — re-run the simulation.
        </div>
      ) : (
        <>
          {tab === "dash" && (
          <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card
              label="Capital do investidor (pico)"
              value={formatMoney(r.kpis.peakCapital, "USD")}
              hint={`aportado ${formatMoney(r.kpis.totalInvested, "USD")} · retornado ${formatMoney(r.kpis.totalReturned, "USD")}`}
            />
            <Card
              label="TIR do investidor (a.a.)"
              value={r.kpis.irrAnnual != null ? `${(r.kpis.irrAnnual * 100).toFixed(2)}%` : "—"}
              hint={
                r.kpis.irrMonthly != null ? `${(r.kpis.irrMonthly * 100).toFixed(2)}% a.m.` : undefined
              }
            />
            <Card
              label="Lucro do investidor"
              value={formatMoney(r.kpis.profit, "USD")}
              hint={
                r.kpis.equityMultiple != null ? `multiple ${r.kpis.equityMultiple.toFixed(2)}x` : undefined
              }
            />
            <Card label="Duração" value={fmtDuration(r.kpis.durationDays)} hint={`${r.units.length} casas`} />
          </div>

          {/* Gráfico de barras na linha do tempo — comprimido, sempre dentro da tela */}
          <CashflowChart monthly={r.monthly} />
          </>
          )}

          {/* Financeiro: cards do banco/4U + fechamento ao centavo */}
          {tab === "financeiro" && (
          <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {sim.compMode === "PERFORMANCE" ? (
              <Card label="Performance 4U" value={formatMoney(r.kpis.perfFeeTotal, "USD")} hint="antes do split" />
            ) : sim.compMode === "PROMOTE" ? (
              <Card label="Promote 4U" value={formatMoney(r.kpis.perfFeeTotal, "USD")} hint="waterfall por tiers" />
            ) : sim.compMode === "OPEN_BOOK" ? (
              <Card
                label="4U — taxa flat (no custo)"
                value={formatMoney(r.kpis.contractorFeeTotal, "USD")}
                hint={
                  r.kpis.perfFeeTotal > 0
                    ? `+ promote ${formatMoney(r.kpis.perfFeeTotal, "USD")} (waterfall)`
                    : `${formatMoney(Number(sim.flatFeePerHouse), "USD")} × ${r.units.length} casas, paga pelos gatilhos`
                }
              />
            ) : (
              <Card label="Contractor fee 4U" value={formatMoney(r.kpis.contractorFeeTotal, "USD")} />
            )}
            {sim.fundingMode === "BANK" && (
              <>
                <Card label="Loan comprometido" value={formatMoney(r.kpis.bankCommitted, "USD")} />
                <Card
                  label="Fees upfront do banco"
                  value={formatMoney(r.kpis.bankUpfrontFees, "USD")}
                  hint={
                    (r.kpis.bankOtherFees ?? 0) > 0
                      ? `+ ${formatMoney(r.kpis.bankOtherFees, "USD")} em fees de draw/payoff`
                      : undefined
                  }
                />
                <Card
                  label="Juros + custos mensais"
                  value={formatMoney(r.kpis.bankInterestTotal, "USD")}
                  hint={
                    r.kpis.bankReserveFunded > 0
                      ? `reserve ${formatMoney(r.kpis.bankReserveFunded, "USD")} · devolvida ${formatMoney(r.kpis.bankReserveUnused, "USD")}${r.kpis.bankExtensionFee > 0 ? ` · extensão ${formatMoney(r.kpis.bankExtensionFee, "USD")}` : ""}`
                      : r.kpis.bankExtensionFee > 0
                        ? `pagos via aporte · extensão ${formatMoney(r.kpis.bankExtensionFee, "USD")}`
                        : "pagos via aporte"
                  }
                />
              </>
            )}
            {sim.fundingMode === "BANK" && (
              <Card
                label="Interest reserve"
                value={
                  r.kpis.bankReserveFunded > 0
                    ? formatMoney(r.kpis.bankReserveFunded, "USD")
                    : "Não tem"
                }
                hint={
                  r.kpis.bankReserveFunded > 0
                    ? `financiada no loan · não usada devolvida (${formatMoney(r.kpis.bankReserveUnused, "USD")})`
                    : "juros mensais saem do caixa — viram aporte do investidor"
                }
              />
            )}
            {sim.fundingMode === "BANK" && (
              <Card
                label="Cash to closing"
                value={
                  Math.abs(r.kpis.cashToClosing ?? 0) > 0.01
                    ? formatMoney(r.kpis.cashToClosing, "USD")
                    : "—"
                }
                hint={
                  (r.kpis.cashToClosing ?? 0) > 0.01
                    ? "excedente do loan — cheque do banco ~15d após o closing"
                    : (r.kpis.cashToClosing ?? 0) < -0.01
                      ? "o loan não cobre fees+reserve+obra — investidor completa no closing"
                      : "loan casa com o uso — nada a devolver/completar"
                }
              />
            )}
            {sim.fundingMode === "BANK" && (
              <Card label="Equity gate" value={formatMoney(r.kpis.equityGateAmount, "USD")} hint={`${Number(sim.equityGatePct)}% dos custos`} />
            )}
          </div>

          {/* Fechamento do projeto: venda − custos − banco − 4U = resultado, ao centavo */}
          {(() => {
            const vendas = r.units.reduce((s, u) => s + u.adjSaleNet, 0);
            const lotes = r.units.reduce((s, u) => s + u.adjLot, 0);
            const obra = r.units.reduce((s, u) => s + u.adjBuild, 0);
            const bankCost =
              r.kpis.bankUpfrontFees +
              r.kpis.bankInterestTotal +
              (r.kpis.bankOtherFees ?? 0) +
              r.kpis.bankExtensionFee;
            const perf = r.kpis.perfFeeTotal;
            const resultado = Math.round((vendas - lotes - obra - bankCost - perf) * 100) / 100;
            const diff = Math.round((resultado - r.kpis.profit) * 100) / 100;
            const fecha = Math.abs(diff) <= 0.01;
            const row = "flex items-baseline justify-between px-5 py-1.5 text-sm";
            const sub = "flex items-baseline justify-between px-5 py-1 pl-10 text-xs text-slate-400";
            return (
              <section className="rounded-xl border border-slate-200 bg-white">
                <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                  <div>
                    <h2 className="text-base font-medium text-slate-800">Fechamento do projeto</h2>
                    <p className="text-xs text-slate-400">
                      Venda − lote − obra − banco − 4U = resultado do investidor, sem faltar um
                      centavo.
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-medium ${
                      fecha ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
                    }`}
                  >
                    {fecha ? "✓ fecha ao centavo" : `✗ diferença ${formatMoney(diff, "USD")}`}
                  </span>
                </div>
                <div className="py-2">
                  <div className={row}>
                    <span className="text-slate-600">(+) Vendas líquidas ({r.units.length} casas)</span>
                    <span className="font-medium tabular-nums text-emerald-700">{formatMoney(vendas, "USD")}</span>
                  </div>
                  <div className={row}>
                    <span className="text-slate-600">(−) Lotes</span>
                    <span className="tabular-nums">{formatMoney(-lotes, "USD")}</span>
                  </div>
                  <div className={row}>
                    <span className="text-slate-600">
                      (−) Obra
                      {sim.compMode === "CONTRACTOR_FEE"
                        ? " (inclui o contractor fee da 4U)"
                        : sim.compMode === "OPEN_BOOK"
                          ? ` (inclui a taxa flat da 4U — ${formatMoney(r.kpis.contractorFeeTotal, "USD")})`
                          : ""}
                    </span>
                    <span className="tabular-nums">{formatMoney(-obra, "USD")}</span>
                  </div>
                  {sim.fundingMode === "BANK" && (
                    <>
                      <div className={row}>
                        <span className="text-slate-600">(−) Custo do banco</span>
                        <span className="tabular-nums">{formatMoney(-bankCost, "USD")}</span>
                      </div>
                      <div className={sub}>
                        <span>fees de closing (orig/broker/título/fixos)</span>
                        <span className="tabular-nums">{formatMoney(-r.kpis.bankUpfrontFees, "USD")}</span>
                      </div>
                      <div className={sub}>
                        <span>
                          juros + custos mensais
                          {r.kpis.bankReserveFunded > 0
                            ? ` (reserve financiada ${formatMoney(r.kpis.bankReserveFunded, "USD")}, não usada devolvida ${formatMoney(r.kpis.bankReserveUnused, "USD")})`
                            : ""}
                        </span>
                        <span className="tabular-nums">{formatMoney(-r.kpis.bankInterestTotal, "USD")}</span>
                      </div>
                      <div className={sub}>
                        <span>taxas de draw/lote/payoff (inspection, ACH, reconveyance…)</span>
                        <span className="tabular-nums">{formatMoney(-(r.kpis.bankOtherFees ?? 0), "USD")}</span>
                      </div>
                      {r.kpis.bankExtensionFee > 0 && (
                        <div className={sub}>
                          <span>extension fee (fim do term)</span>
                          <span className="tabular-nums">{formatMoney(-r.kpis.bankExtensionFee, "USD")}</span>
                        </div>
                      )}
                    </>
                  )}
                  {perf > 0 && (
                    <div className={row}>
                      <span className="text-slate-600">
                        (−) 4U — {sim.compMode === "PROMOTE" || ((sim.promoteTiers as unknown[] | null)?.length && sim.compMode === "OPEN_BOOK") ? "promote (waterfall)" : `performance ${Number(sim.perfPct)}%`}
                      </span>
                      <span className="tabular-nums">{formatMoney(-perf, "USD")}</span>
                    </div>
                  )}
                  <div className={`${row} border-t border-slate-100 pt-2`}>
                    <span className="font-semibold text-slate-800">(=) Resultado do investidor</span>
                    <span className={`font-semibold tabular-nums ${resultado < 0 ? "text-red-600" : "text-emerald-700"}`}>
                      {formatMoney(resultado, "USD")}
                    </span>
                  </div>
                  <div className={sub}>
                    <span>aportado {formatMoney(r.kpis.totalInvested, "USD")} · retornado {formatMoney(r.kpis.totalReturned, "USD")} · TIR {r.kpis.irrAnnual != null ? `${(r.kpis.irrAnnual * 100).toFixed(2)}%` : "—"}</span>
                    <span></span>
                  </div>
                </div>
              </section>
            );
          })()}

          </>
          )}

          {/* Comparador de bancos: mesma cesta de casas, N perfis, melhor opção marcada */}
          {tab === "setup" && (
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-medium text-slate-800">Comparar bancos</h2>
              <p className="text-xs text-slate-400">
                Roda esta mesma simulação para cada banco (perfis do catálogo, incl. os lidos de
                LOI) e marca a melhor opção — maior TIR do investidor, lucro desempata.
              </p>
            </div>
            {comparison && comparison.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className={th}>Banco</th>
                      <th className={thRight}>TIR investidor</th>
                      <th className={thRight}>Lucro</th>
                      <th className={thRight}>Aporte (pico)</th>
                      <th className={thRight}>Custo do banco</th>
                      <th className={thRight}>Cash to closing</th>
                      <th className={thRight}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {comparison.map((c) => (
                      <tr
                        key={c.bankId}
                        className={`border-b border-slate-50 ${c.best ? "bg-emerald-50/50" : ""}`}
                      >
                        <td className={`${td} font-medium text-slate-800`}>
                          {c.bankName}
                          {c.best && (
                            <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-700">
                              ★ melhor opção
                            </span>
                          )}
                          {sim.bankProfileId === c.bankId && (
                            <span className="ml-2 text-xs text-slate-400">(atual)</span>
                          )}
                        </td>
                        <td className={`${tdRight} font-semibold`}>
                          {c.irr != null ? `${(c.irr * 100).toFixed(1)}%` : "—"}
                        </td>
                        <td className={`${tdRight} ${c.profit < 0 ? "text-red-600" : ""}`}>
                          {formatMoney(c.profit, "USD")}
                        </td>
                        <td className={tdRight}>{formatMoney(c.peak, "USD")}</td>
                        <td className={tdRight}>{formatMoney(c.bankCost, "USD")}</td>
                        <td className={`${tdRight} ${(c.ctc ?? 0) > 0 ? "text-emerald-700" : (c.ctc ?? 0) < 0 ? "text-red-600" : "text-slate-400"}`}>
                          {Math.abs(c.ctc ?? 0) > 0.01 ? formatMoney(c.ctc!, "USD") : "—"}
                        </td>
                        <td className={tdRight}>
                          {sim.bankProfileId !== c.bankId && (
                            <form action={useComparedBank} className="inline">
                              <input type="hidden" name="simulationId" value={sim.id} />
                              <input type="hidden" name="bankId" value={c.bankId} />
                              <button
                                type="submit"
                                className="rounded bg-[#1f3a5f] px-2 py-1 text-xs font-medium text-white hover:bg-[#16304f]"
                              >
                                Usar este
                              </button>
                            </form>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <BankMultiSelect
              simulationId={sim.id}
              banks={bankOptions}
              initialSelected={comparison?.map((c) => c.bankId) ?? (sim.bankProfileId ? [sim.bankProfileId] : [])}
            />
            {/* Bancos mandam condições novas toda hora — suba o LOI aqui e ele entra na lista */}
            <details className="border-t border-slate-100 px-5 py-3">
              <summary className="cursor-pointer text-sm text-[#1f3a5f] hover:underline">
                ↑ Chegou LOI novo? Suba aqui — a AI extrai os termos e o banco entra na comparação
              </summary>
              <div className="pt-3">
                <BankLoiUpload banks={allBanks.map((b) => ({ id: b.id, name: b.name }))} />
              </div>
            </details>
          </section>
          )}

          {tab === "casas" && (
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-medium text-slate-800">Casas</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={th}>#</th>
                    <th className={th}>Casa</th>
                    <th className={thRight}>Lote (aj.)</th>
                    <th className={thRight}>Obra (aj.)</th>
                    <th className={thRight}>Venda líq. (aj.)</th>
                    <th className={thRight}>Loan elegível</th>
                    <th className={thRight}>Lucro</th>
                    <th className={thRight}>Compra lote</th>
                    <th className={thRight}>Início obra</th>
                    <th className={thRight}>Recebimento</th>
                  </tr>
                </thead>
                <tbody>
                  {r.units.map((u, i) => (
                    <tr key={i} className="border-b border-slate-50">
                      <td className={td}>{i + 1}</td>
                      <td className={`${td} font-medium text-slate-800`}>{u.label}</td>
                      <td className={tdRight}>{formatMoney(u.adjLot, "USD")}</td>
                      <td className={tdRight}>{formatMoney(u.adjBuild, "USD")}</td>
                      <td className={tdRight}>{formatMoney(u.adjSaleNet, "USD")}</td>
                      <td className={tdRight}>{u.bankEligible ? formatMoney(u.bankEligible, "USD") : "—"}</td>
                      <td className={`${tdRight} ${u.profit < 0 ? "text-red-600" : "text-emerald-700"}`}>
                        {formatMoney(u.profit, "USD")}
                      </td>
                      <td className={tdRight}>D+{u.tLotClose}</td>
                      <td className={tdRight}>D+{u.tBuildStart}</td>
                      <td className={tdRight}>D+{u.tCashIn}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50/60">
                    <td className={`${td} font-semibold text-slate-800`} colSpan={2}>
                      Total ({r.units.length} casas)
                    </td>
                    <td className={`${tdRight} font-semibold`}>
                      {formatMoney(r.units.reduce((s, u) => s + u.adjLot, 0), "USD")}
                    </td>
                    <td className={`${tdRight} font-semibold`}>
                      {formatMoney(r.units.reduce((s, u) => s + u.adjBuild, 0), "USD")}
                    </td>
                    <td className={`${tdRight} font-semibold`}>
                      {formatMoney(r.units.reduce((s, u) => s + u.adjSaleNet, 0), "USD")}
                    </td>
                    <td className={`${tdRight} font-semibold`}>
                      {formatMoney(r.units.reduce((s, u) => s + u.bankEligible, 0), "USD")}
                    </td>
                    <td className={`${tdRight} font-semibold`}>
                      {formatMoney(r.units.reduce((s, u) => s + u.profit, 0), "USD")}
                    </td>
                    <td colSpan={3}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
          )}

          {/* Cálculos do loan: dimensionamento por casa (base contractor+fee+lote),
              envelope → CTC, e o quadro mensal dos custos do banco */}
          {tab === "loan" && (
          <>
          {!isBank ? (
            <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
              Simulação em equity — troque o funding para Banco no Setup para ver os cálculos
              do loan.
            </div>
          ) : (
          <>
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-medium text-slate-800">Quanto o banco financia por casa</h2>
              <p className="text-xs text-slate-400">
                Base do LTC = custo contractor + fee da obra + lote do location — valores
                PUROS do catálogo (o banco usa o orçamento real; buffers de cenário são
                internos). O banco desembolsa TUDO que aprovar — o excedente sobre o custo
                real volta ao cliente como reembolso (cash to closing). Na conversão para
                pool, o financiado vira o budget de draw da casa (ajustável na ficha).
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={th}>Casa</th>
                    <th className={thRight}>Obra (contractor)</th>
                    <th className={thRight}>Fee da obra</th>
                    <th className={thRight}>Lote</th>
                    <th className={thRight}>Base LTC</th>
                    <th className={thRight}>LTC → valor</th>
                    <th className={thRight}>LTV → valor</th>
                    <th className={thRight}>Financiado</th>
                    <th className={th}>Limitou</th>
                  </tr>
                </thead>
                <tbody>
                  {r.units.map((u, i) => {
                    const contractBuild = Math.round((u.bankLtcBasis - u.lotCost) * 100) / 100;
                    const fee = u.contractorFee;
                    const binding =
                      u.bankEligible >= (u.bankLtcCap ?? 0) - 0.01 ? "LTC" : u.bankEligible >= (u.bankLtvCap ?? 0) - 0.01 ? "LTV" : "cap";
                    return (
                      <tr key={i} className="border-b border-slate-50">
                        <td className={`${td} font-medium text-slate-800`}>{u.label}</td>
                        <td className={tdRight}>{formatMoney(contractBuild - fee, "USD")}</td>
                        <td className={tdRight}>{formatMoney(fee, "USD")}</td>
                        <td className={tdRight}>{formatMoney(u.lotCost, "USD")}</td>
                        <td className={`${tdRight} font-medium`}>{formatMoney(u.bankLtcBasis, "USD")}</td>
                        <td className={tdRight}>{formatMoney(u.bankLtcCap, "USD")}</td>
                        <td className={tdRight}>{formatMoney(u.bankLtvCap, "USD")}</td>
                        <td className={`${tdRight} font-semibold text-slate-900`}>{formatMoney(u.bankEligible, "USD")}</td>
                        <td className={td}>
                          <span className={`rounded-full px-2 py-0.5 text-xs ${binding === "LTV" ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>
                            {binding}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-50/60">
                    <td className={`${td} font-semibold text-slate-800`}>Total ({r.units.length} casas)</td>
                    <td colSpan={6}></td>
                    <td className={`${tdRight} font-semibold`}>{formatMoney(r.kpis.bankCommitted, "USD")}</td>
                    <td></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div className="border-t border-slate-100 px-5 py-4 text-sm">
              <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">
                Envelope do loan → cash to closing
              </div>
              <div className="flex flex-wrap gap-x-8 gap-y-1 tabular-nums text-slate-600">
                <span>Comprometido {formatMoney(r.kpis.bankCommitted, "USD")}</span>
                <span>(−) fees rolados {formatMoney(r.kpis.bankUpfrontFees, "USD")}</span>
                <span>(−) interest reserve {formatMoney(r.kpis.bankReserveFunded, "USD")}</span>
                <span>
                  (−) draws da obra{" "}
                  {formatMoney(
                    Math.round(
                      (r.kpis.bankCommitted -
                        r.kpis.bankUpfrontFees -
                        r.kpis.bankReserveFunded -
                        (r.kpis.cashToClosing ?? 0)) *
                        100,
                    ) / 100,
                    "USD",
                  )}
                </span>
                <span className={`font-semibold ${(r.kpis.cashToClosing ?? 0) > 0 ? "text-emerald-700" : (r.kpis.cashToClosing ?? 0) < 0 ? "text-red-600" : ""}`}>
                  (=) Cash to closing {formatMoney(r.kpis.cashToClosing ?? 0, "USD")}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-400">
                {(r.kpis.cashToClosing ?? 0) > 0.01
                  ? "Excedente devolvido ao cliente ~15 dias após o closing (reembolso pelos custos antecipados) — pode financiar novos projetos, pagando juros até o payoff."
                  : (r.kpis.cashToClosing ?? 0) < -0.01
                    ? "O loan não cobre fees + reserve + obra — o investidor completa em cash no closing."
                    : "Loan casa com o uso — nada a devolver ou completar."}
              </p>
            </div>
          </section>

          <BankCostsMonthly events={r.events} kpis={r.kpis} isBank={isBank} />
          </>
          )}
          </>
          )}

          {tab === "ledger" && (
          <>
          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-medium text-slate-800">Resumo mensal (investidor)</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full max-w-2xl">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={th}>Mês</th>
                    <th className={thRight}>Aportes</th>
                    <th className={thRight}>Retornos</th>
                    <th className={thRight}>Capital em risco</th>
                  </tr>
                </thead>
                <tbody>
                  {r.monthly.map((m) => (
                    <tr key={m.month} className="border-b border-slate-50">
                      <td className={td}>M{m.month}</td>
                      <td className={tdRight}>{m.inflow ? formatMoney(m.inflow, "USD") : "—"}</td>
                      <td className={tdRight}>{m.outflow ? formatMoney(m.outflow, "USD") : "—"}</td>
                      <td className={tdRight}>{formatMoney(m.balance, "USD")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <SimLedger
            isBank={isBank}
            rows={r.events.map(
              (e): LedgerRow => ({
                day: e.day,
                kind: e.kind,
                kindLabel: KIND_LABEL[e.kind] ?? e.kind,
                label: e.label,
                amount: e.amount,
                bankAmount: e.bankAmount ?? null,
                cash: e.cash,
                bankBalance: e.bankBalance,
                invested: e.invested,
                // regra do caixa-primeiro visível: gasto sem aporte no mesmo dia = verde
                paidFromCash:
                  e.amount < 0 &&
                  e.kind !== "RETURN" &&
                  e.kind !== "BANK_PAYOFF" &&
                  !injectionDays.has(e.day),
              }),
            )}
          />
          </>
          )}
        </>
      )}
    </div>
  );
}
