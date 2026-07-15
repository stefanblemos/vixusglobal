import React from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import {
  convertSimulationToPool,
  deleteSimulation,
  duplicateSimulation,
  rerunSimulation,
  useComparedBank,
} from "@/lib/actions/simulations";
import { simulate, type SimResult } from "@/lib/pools/simulator";
import {
  buildSimInput,
  comboKey,
  countOverrides,
  type PromoteTierInput,
  type SimOverrides,
  type UnitRef,
} from "@/lib/pools/build-sim-input";
import { SimulationControls } from "@/components/simulation-controls";
import { SimulationUnitsEditor } from "@/components/simulation-units-editor";
import {
  SimulationPremissas,
  type PremissasCombo,
  type PremissasLocation,
  type PremissasScenario,
} from "@/components/simulation-premissas";
import { BankMultiSelect } from "@/components/bank-multiselect";
import { BankLoiUpload } from "@/components/bank-loi-upload";
import { SimLedger, type LedgerRow } from "@/components/sim-ledger";
import { daysToMonths, phasesOf } from "@/lib/pools/phases";
import { benchmarkOf } from "@/lib/pools/benchmark";

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
  VEHICLE: "Custos do veículo",
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
  upfront?: number;
  interest?: number;
  otherFees?: number;
  extFee?: number;
  feesFinanced?: boolean;
  reserveFunded?: number;
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
  ["premissas", "Premissas"],
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
  const isCycled = (r?.units ?? []).some((u) => (u.cycle ?? 1) > 1);
  // dias que precisaram de aporte — usado p/ marcar contas pagas do caixa (verde)
  const injectionDays = new Set(
    (r?.events ?? []).filter((e) => e.kind === "INJECTION").map((e) => e.day),
  );
  const [allBanks, allScenarios, catalogLocations, catalogModelLocations, houseTypeFees, defaultWaterfallTiers, catalogVehicleCosts] = await Promise.all([
    prisma.bankProfile.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        lois: { orderBy: { createdAt: "desc" }, take: 1, select: { loiNumber: true, loiDate: true } },
      },
    }),
    prisma.bufferScenario.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.catalogLocation.findMany({
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        lotCostEstimate: true,
        lotLeadDays: true,
        permitDays: true,
        saleDays: true,
      },
    }),
    prisma.catalogModelLocation.findMany({ include: { model: true } }),
    prisma.houseTypeFee.findMany(),
    prisma.catalogWaterfallTier.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.catalogVehicleCost.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  // catálogo p/ o editor de cesta (mesma forma do /simulator/new) — só plain objects
  // atravessam a fronteira server→client (Decimal do Prisma não pode vazar)
  const unitsCatalog = {
    locations: catalogLocations.map((l) => ({ id: l.id, name: l.name })),
    modelLocations: catalogModelLocations.map((ml) => ({
      locationId: ml.locationId,
      modelId: ml.modelId,
      modelName: ml.model.name,
      salePrice: Number(ml.salePrice),
      costPerformance: ml.costPerformance == null ? null : Number(ml.costPerformance),
      costContractor: ml.costContractor == null ? null : Number(ml.costContractor),
      costOpenBook: ml.costOpenBook == null ? null : Number(ml.costOpenBook),
    })),
  };
  // Aba Premissas: só locations/combinações presentes na CESTA, com valores do catálogo
  const simOverrides = (sim.overrides as SimOverrides | null) ?? null;
  const overridesCount = countOverrides(simOverrides);
  const basketRefs = (sim.units as UnitRef[]) ?? [];
  const feeByType = new Map(houseTypeFees.map((f) => [f.type as string, Number(f.fee)]));
  const premissasLocations: PremissasLocation[] = catalogLocations
    .filter((l) => basketRefs.some((u) => u.locationId === l.id))
    .map((l) => ({
      id: l.id,
      name: l.name,
      catalog: {
        lotCost: l.lotCostEstimate == null ? null : Number(l.lotCostEstimate),
        lotLeadDays: l.lotLeadDays,
        permitDays: l.permitDays,
        saleDays: l.saleDays,
      },
    }));
  const premissasCombos: PremissasCombo[] = catalogModelLocations
    .filter((ml) => basketRefs.some((u) => u.modelId === ml.modelId && u.locationId === ml.locationId))
    .map((ml) => ({
      key: comboKey(ml.modelId, ml.locationId),
      label: `${ml.model.name} @ ${catalogLocations.find((l) => l.id === ml.locationId)?.name ?? "?"}`,
      catalog: {
        salePrice: Number(ml.salePrice),
        costPerformance: ml.costPerformance == null ? null : Number(ml.costPerformance),
        costContractor: ml.costContractor == null ? null : Number(ml.costContractor),
        costOpenBook: ml.costOpenBook == null ? null : Number(ml.costOpenBook),
        contractorFee: Number(ml.model.contractorFee ?? feeByType.get(ml.model.houseType) ?? 0),
        buildMonths: Number(ml.model.buildMonths),
      },
    }));

  const premissasScenarios: PremissasScenario[] = allScenarios.map((sc) => ({
    code: sc.code,
    name: sc.name,
    catalog: {
      salePriceBufferPct: Number(sc.salePriceBufferPct),
      constructionCostBufferPct: Number(sc.constructionCostBufferPct),
      lotCostBufferPct: Number(sc.lotCostBufferPct),
      closingFeePct: Number(sc.closingFeePct),
      contingencyReservePct: Number(sc.contingencyReservePct),
      landAcquisitionDays: sc.landAcquisitionDays,
      saleClosingDays: sc.saleClosingDays,
      constructionDurationBufferM: Number(sc.constructionDurationBufferM),
      salesAbsorptionMonths: sc.salesAbsorptionMonths == null ? null : Number(sc.salesAbsorptionMonths),
      emdPct: Number(sc.emdPct),
      unitGapDays: sc.unitGapDays,
    },
  }));

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
    unitGapDays: sim.unitGapDays,
    bankProfileId: sim.bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
    overrides: (sim.overrides as SimOverrides | null) ?? null,
    vehicleStructure: sim.vehicleStructure,
  };
  const scenarioCards = await Promise.all(
    allScenarios.map(async (s) => {
      const input = await buildSimInput({ ...simFieldsBase, scenarioCode: s.code });
      if ("error" in input) return { code: s.code, name: s.name, kpis: null };
      const res = simulate(input);
      return {
        code: s.code,
        name: s.name,
        kpis: {
          irr: res.kpis.irrAnnual,
          profit: res.kpis.profit,
          peak: res.kpis.peakCapital,
          roi: res.kpis.peakCapital > 0 ? res.kpis.profit / res.kpis.peakCapital : null,
        },
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
                ? "promote (legado)"
                : sim.compMode === "OPEN_BOOK"
                  ? `open book + flat ${formatMoney(Number(sim.flatFeePerHouse), "USD")}/casa`
                  : "contractor fee"}
            {(sim.promoteTiers as unknown[] | null)?.length && sim.compMode !== "PROMOTE" ? " · waterfall Vixus" : ""}
            {sim.vehicleStructure === "CLIENT_ENTITY" ? ` · entidade do cliente${sim.clientEntityName ? ` (${sim.clientEntityName})` : ""}` : ""}
            {" · "}
            {sim.paymentPlan === "LIGHT_START"
              ? "desembolso 10/15/25/25/20/5"
              : sim.paymentPlan === "PARTNER"
                ? "desembolso sócios 10/10/25/25/25/5"
                : "desembolso 10/30/20/20/15/5"}
            {sim.pool ? ` · pool ${sim.pool.code}` : ""}
            {overridesCount > 0 && (
              <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                premissas ajustadas ({overridesCount})
              </span>
            )}
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
          {/* Idioma escolhido ANTES de gerar (15/07): EN canônico · PT/ES = tradução livre
              com ressalva de que o inglês prevalece. <details> nativo — sem client component */}
          <details className="relative">
            <summary
              title="Investment Summary canônico (DOCX) — 3 cenários + sensibilidade + apêndice financeiro, sempre fresco do catálogo. Escolha o idioma."
              className="cursor-pointer list-none rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              📄 Investment Summary ▾
            </summary>
            <div className="absolute right-0 z-20 mt-1 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              <a
                href={`/api/simulations/${sim.id}/report`}
                className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                🇺🇸 English <span className="text-xs text-slate-400">(canônico)</span>
              </a>
              <a
                href={`/api/simulations/${sim.id}/report?lang=pt`}
                className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                🇧🇷 Português (BR)
              </a>
              <a
                href={`/api/simulations/${sim.id}/report?lang=es`}
                className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
              >
                🇲🇽 Español (LatAm)
              </a>
              <p className="border-t border-slate-100 px-4 pb-1 pt-2 text-[10px] leading-snug text-slate-400">
                PT/ES são traduções livres — a versão em inglês prevalece (nota no documento).
              </p>
            </div>
          </details>
          <SimulationUnitsEditor
            simulationId={sim.id}
            fundingMode={sim.fundingMode}
            initialUnits={((sim.units as UnitRef[]) ?? []).map((u) => ({
              locationId: u.locationId,
              modelId: u.modelId,
              cycle: u.cycle ?? 1,
            }))}
            catalog={unitsCatalog}
          />
          <form action={duplicateSimulation}>
            <input type="hidden" name="simulationId" value={sim.id} />
            <button
              type="submit"
              title="A simulação é viva (sobrescreve) — duplicar é como se guarda uma versão"
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
            >
              ⧉ Duplicar
            </button>
          </form>
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
      {tab === "premissas" && (
        <SimulationPremissas
          key={JSON.stringify(simOverrides)}
          simulationId={sim.id}
          scenarioName={sim.scenario.name}
          baseCode="REAL"
          locations={premissasLocations}
          combos={premissasCombos}
          scenarios={premissasScenarios}
          vehicleCosts={
            sim.vehicleStructure === "VIXUS_MANAGED"
              ? catalogVehicleCosts.map((c) => ({
                  id: c.id,
                  name: c.name,
                  timing: c.timing,
                  catalogAmount: Number(c.amount),
                }))
              : []
          }
          overrides={simOverrides}
        />
      )}

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
          vehicleStructure: sim.vehicleStructure,
          clientEntityName: sim.clientEntityName,
          promoteTiers:
            (sim.promoteTiers as Array<{ hurdlePct: number | null; promotePct: number }> | null) ??
            null,
        }}
        scenarios={allScenarios.map((sc) => ({ code: sc.code, name: sc.name }))}
        defaultTiers={defaultWaterfallTiers.map((t) => ({
          hurdlePct: t.hurdlePct == null ? null : Number(t.hurdlePct),
          promotePct: Number(t.promotePct),
        }))}
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
                <div className="text-xs text-slate-400">
                  {s.kpis.roi != null ? `ROI ${(s.kpis.roi * 100).toFixed(1)}% · ` : ""}
                  pico {formatMoney(s.kpis.peak, "USD")}
                </div>
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
                `ROI ${r.kpis.peakCapital > 0 ? ((r.kpis.profit / r.kpis.peakCapital) * 100).toFixed(1) : "—"}% sobre o pico${r.kpis.irrMonthly != null ? ` · ${(r.kpis.irrMonthly * 100).toFixed(2)}% a.m.` : ""}`
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

          {/* Fases do projeto: onde o tempo (e o loan) mora — barras sobrepostas + janela
              real de exposição a juros vs term do banco (aprovado no mock, 13/07) */}
          {(() => {
            const ph = phasesOf(r, sim.bankProfile?.termMonths ?? null);
            const scaleEnd = Math.max(
              ph.totalDays,
              ph.loan?.termDays != null ? ph.loan.closingDay + ph.loan.termDays : 0,
            );
            const pct = (d: number) => `${((d / scaleEnd) * 100).toFixed(1)}%`;
            const COLORS: Record<string, string> = {
              lots: "#a3b18a",
              permits: "#94a3b8",
              build: "#e9a23b",
              sales: "#4c9f70",
              loan: "#1f3a5f",
            };
            const SUBS: Record<string, string> = {
              lots: "busca → closing",
              sales: "CO → caixa",
              loan: "closing → payoff",
            };
            const bars = [
              ...ph.phases,
              ...(ph.loan
                ? [
                    {
                      key: "loan",
                      label: "Loan",
                      from: ph.loan.from,
                      to: ph.loan.to,
                      segments: ph.loan.segments,
                      activeDays: ph.loan.activeDays,
                    },
                  ]
                : []),
            ];
            return (
              <section className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-base font-medium text-slate-800">Fases do projeto</h2>
                  <p className="text-xs text-slate-400">
                    Períodos primeira→última casa — as fases se sobrepõem (é a eficiência do
                    desenho; a soma passa da duração do projeto).
                    {ph.loan ? " A faixa do loan é a janela real de exposição a juros." : ""}
                  </p>
                </div>
                <div className="space-y-2.5 px-5 py-4">
                  {bars.map((b) => (
                    <div key={b.key} className="grid grid-cols-[90px_1fr_170px] items-center gap-3">
                      <div className="text-right text-sm text-slate-600">
                        <span className="font-medium">{b.label}</span>
                        {SUBS[b.key] && (
                          <span className="block text-[10px] text-slate-400">{SUBS[b.key]}</span>
                        )}
                      </div>
                      <div className="relative h-5 rounded-md bg-slate-100">
                        {/* segmentado: blocos reais casa a casa — gap da esteira aparece como vazio */}
                        {b.segments.map(([a, z], i) => (
                          <div
                            key={i}
                            className="absolute bottom-0.5 top-0.5 rounded"
                            style={{ left: pct(a), width: pct(z - a), background: COLORS[b.key] }}
                          />
                        ))}
                        {b.key === "loan" && ph.loan?.termDays != null && (
                          <div
                            title={`term do banco: ${Math.round(ph.loan.termDays / 30)}m a partir do closing do loan`}
                            className="absolute -bottom-1 -top-1 border-l-2 border-dashed border-red-500"
                            style={{ left: pct(ph.loan.closingDay + ph.loan.termDays) }}
                          />
                        )}
                      </div>
                      <div className="text-xs tabular-nums text-slate-500">
                        D+{b.from} → D+{b.to} ·{" "}
                        <span className="font-semibold text-slate-700">
                          {daysToMonths(b.to - b.from)}m
                        </span>
                        {b.to - b.from - b.activeDays > 3 && (
                          <span className="block text-[10px] text-slate-400">
                            {daysToMonths(b.activeDays)}m ativos · {b.segments.length} blocos
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {ph.loan && (
                    <p className="pt-1 text-xs">
                      {ph.loan.overrunDays > 0 ? (
                        <span className="rounded-full bg-red-50 px-2.5 py-1 font-medium text-red-700">
                          ✗ estoura o term em {daysToMonths(ph.loan.overrunDays)}m
                          {r.kpis.bankExtensionFee > 0
                            ? ` — extension fee ${formatMoney(r.kpis.bankExtensionFee, "USD")}`
                            : ""}
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700">
                          ✓ loan aberto {daysToMonths(ph.loan.activeDays)}m de{" "}
                          {daysToMonths(ph.totalDays)}m do projeto
                          {ph.loan.termDays != null
                            ? ` — zera ${daysToMonths(ph.loan.closingDay + ph.loan.termDays - ph.loan.to)}m antes do term`
                            : ""}
                        </span>
                      )}
                    </p>
                  )}
                </div>
              </section>
            );
          })()}

          {/* Benchmark de premissas × vendidos no submarket (ATTOM) — aprovado 14/07 */}
          {(() => {
            const sqftByModel = new Map(
              catalogModelLocations.map((ml) => [ml.model.name, ml.model.sqft ?? null]),
            );
            const bm = benchmarkOf(r.units, sqftByModel);
            const fmtV = (v: number, unit: string) =>
              unit === "$/sf" ? `$${v.toFixed(0)}/sf` : formatMoney(v, "USD").replace(".00", "");
            const BADGE: Record<string, [string, string]> = {
              CONSERVATIVE: ["✓ conservador", "bg-emerald-50 text-emerald-700"],
              IN_RANGE: ["✓ dentro da faixa", "bg-emerald-50 text-emerald-700"],
              TOP: ["⚠ topo do mercado", "bg-amber-50 text-amber-700"],
              BELOW: ["⚠ abaixo do vendido", "bg-amber-50 text-amber-700"],
              NO_DATA: ["— sem dados ATTOM", "bg-slate-100 text-slate-500"],
            };
            return (
              <section className="rounded-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 px-5 py-4">
                  <h2 className="text-base font-medium text-slate-800">Benchmark vs mercado</h2>
                  <p className="text-xs text-slate-400">
                    Premissas desta simulação × VENDIDOS no submarket (ATTOM {bm.extractDate},{" "}
                    {bm.windowDays} dias). Vendas comparam em $/SF quando o modelo tem metragem
                    no catálogo; sem metragem, preço absoluto (mistura tamanhos — cadastre o
                    sqft do modelo para o benchmark justo).
                  </p>
                </div>
                <div className="overflow-x-auto px-5 py-3">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className={th}>Premissa</th>
                        <th className={thRight}>Nosso valor</th>
                        <th className={thRight}>Mediana do vendido</th>
                        <th className={thRight}>Percentil</th>
                        <th className={thRight}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {(["lot", "sale"] as const).map((kind) => (
                        <React.Fragment key={kind}>
                          <tr className="bg-slate-50/70">
                            <td colSpan={5} className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                              {kind === "lot" ? "Lotes (custo) × lotes vendidos" : "Vendas × new construction vendida"}
                            </td>
                          </tr>
                          {bm.rows
                            .filter((b) => b.kind === kind)
                            .map((b) => (
                              <tr key={b.label} className="border-b border-slate-50">
                                <td className={td}>{b.label}</td>
                                <td className={tdRight}>{fmtV(b.ours, b.unit)}</td>
                                <td className={tdRight}>
                                  {b.marketMedian == null ? "—" : fmtV(b.marketMedian, b.unit)}
                                  {b.n > 0 && <span className="ml-1 text-[10px] text-slate-400">n={b.n}</span>}
                                </td>
                                <td className={tdRight}>{b.percentile == null ? "—" : `P${b.percentile}`}</td>
                                <td className="px-3 py-1.5 text-right">
                                  <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${BADGE[b.verdict][1]}`}>
                                    {BADGE[b.verdict][0]}
                                    {b.verdict === "CONSERVATIVE" && b.deltaPct != null && b.kind === "lot"
                                      ? ` +${Math.round(b.deltaPct * 100)}%`
                                      : ""}
                                  </span>
                                </td>
                              </tr>
                            ))}
                        </React.Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            );
          })()}

          {/* Esteira de ciclos: quebra por ciclo com clareza (pedido do Stefan) */}
          {isCycled && (
            <section className="rounded-xl border border-slate-200 bg-white">
              <div className="border-b border-slate-100 px-5 py-4">
                <h2 className="text-base font-medium text-slate-800">Ciclos — a esteira</h2>
                <p className="text-xs text-slate-400">
                  Vendeu uma, começa uma: a obra do ciclo seguinte inicia no dia seguinte à
                  venda-gatilho; lote + F1 (permit) das engatilhadas são antecipados, F2 é
                  paga com o dinheiro da venda.
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className={th}>Ciclo</th>
                      <th className={thRight}>Casas</th>
                      <th className={thRight}>1ª obra</th>
                      <th className={thRight}>Última venda</th>
                      <th className={thRight}>Vendas Σ</th>
                      <th className={thRight}>Lucro Σ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...new Set(r.units.map((u) => u.cycle ?? 1))]
                      .sort((a, b) => a - b)
                      .map((c) => {
                        const g = r.units.filter((u) => (u.cycle ?? 1) === c);
                        return (
                          <tr key={c} className="border-b border-slate-50">
                            <td className={`${td} font-medium text-slate-800`}>C{c}</td>
                            <td className={tdRight}>{g.length}</td>
                            <td className={tdRight}>D+{Math.min(...g.map((u) => u.tBuildStart))}</td>
                            <td className={tdRight}>D+{Math.max(...g.map((u) => u.tCashIn))}</td>
                            <td className={tdRight}>{formatMoney(g.reduce((s2, u) => s2 + u.adjSaleNet, 0), "USD")}</td>
                            <td className={`${tdRight} ${g.reduce((s2, u) => s2 + u.profit, 0) < 0 ? "text-red-600" : "text-emerald-700"}`}>
                              {formatMoney(g.reduce((s2, u) => s2 + u.profit, 0), "USD")}
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </section>
          )}

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
            const promote = r.kpis.promoteTotal ?? 0; // snapshot antigo: promote dentro do perf
            const veiculo = r.kpis.vehicleCostTotal ?? 0; // snapshot antigo: sem custos do veículo
            const resultado = Math.round((vendas - lotes - obra - bankCost - perf - promote - veiculo) * 100) / 100;
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
                        (−) 4U — {sim.compMode === "PROMOTE" ? "promote (legado)" : `performance ${Number(sim.perfPct)}%`}
                      </span>
                      <span className="tabular-nums">{formatMoney(-perf, "USD")}</span>
                    </div>
                  )}
                  {promote > 0 && (
                    <div className={row}>
                      <span className="text-slate-600">(−) Vixus — waterfall (developer)</span>
                      <span className="tabular-nums">{formatMoney(-promote, "USD")}</span>
                    </div>
                  )}
                  {veiculo > 0 && (
                    <div className={row}>
                      <span className="text-slate-600">(−) Custos do veículo (abertura/contador/encerramento)</span>
                      <span className="tabular-nums">{formatMoney(-veiculo, "USD")}</span>
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
                LOI). Não existe &quot;melhor banco&quot; absoluto — existe o melhor para a
                pergunta que você está fazendo: os cards respondem cada pergunta e a tabela mostra
                os três ângulos com barras na mesma escala.
              </p>
            </div>
            {comparison && comparison.length > 0 && (() => {
              // Desenho aprovado 14/07: cards de critério + barras por coluna + campeões.
              // ROI = lucro ÷ aporte pico (o que conversa com o tamanho da captação).
              const rows = comparison.map((c) => ({
                ...c,
                roi: c.peak > 0 ? c.profit / c.peak : null,
              }));
              const maxIrr = Math.max(...rows.map((c) => c.irr ?? -Infinity));
              const maxRoi = Math.max(...rows.map((c) => c.roi ?? -Infinity));
              const maxProfit = Math.max(...rows.map((c) => c.profit));
              const bestIrr = rows.find((c) => c.irr === maxIrr);
              const bestRoi = rows.find((c) => c.roi === maxRoi);
              const bestProfit = rows.find((c) => c.profit === maxProfit);
              const pctBar = (v: number | null, max: number) =>
                v == null || max <= 0 ? 0 : Math.max(4, Math.round((v / max) * 100));
              const Dot = ({ color }: { color: string }) => (
                <span
                  className="ml-1.5 inline-block h-[7px] w-[7px] rounded-full align-[1px]"
                  style={{ background: color }}
                />
              );
              const Bar = ({ pct, color }: { pct: number; color: string }) => (
                <span className="mt-1 block h-[7px] w-[120px] rounded bg-slate-100">
                  <span className="block h-full rounded" style={{ width: `${pct}%`, background: color }} />
                </span>
              );
              const GREEN = "#10b981";
              const INDIGO = "#6366f1";
              const AMBER = "#f59e0b";
              return (
                <div>
                  {/* cards de critério: qual pergunta você está fazendo? */}
                  <div className="grid grid-cols-1 gap-3 px-5 pt-4 md:grid-cols-3">
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
                        💨 Retorno mais rápido (TIR)
                      </div>
                      <div className="mt-1 text-base font-bold text-slate-900">{bestIrr?.bankName ?? "—"}</div>
                      <div className="text-sm text-slate-700">
                        {bestIrr?.irr != null ? `${(bestIrr.irr * 100).toFixed(1)}% a.a.` : "—"} · aporte{" "}
                        {bestIrr ? formatMoney(bestIrr.peak, "USD").replace(/\.\d\d$/, "") : "—"}
                      </div>
                      <div className="mt-1.5 text-[10.5px] leading-snug text-slate-500">
                        {bestIrr?.feesFinanced || (bestIrr?.reserveFunded ?? 0) > 0
                          ? "Financia fees/reserve dentro do loan → menos aporte seu. "
                          : ""}
                        Escolha quando o capital é <b>escasso</b> ou tem outro destino.
                      </div>
                    </div>
                    <div className="rounded-lg border border-indigo-200 bg-indigo-50/60 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-indigo-700">
                        💰 Rendimento por dólar (ROI)
                      </div>
                      <div className="mt-1 text-base font-bold text-slate-900">{bestRoi?.bankName ?? "—"}</div>
                      <div className="text-sm text-slate-700">
                        {bestRoi?.roi != null ? `${(bestRoi.roi * 100).toFixed(1)}% sobre o pico` : "—"}
                        {bestRoi?.roi != null ? ` · ${(1 + bestRoi.roi).toFixed(2)}x` : ""}
                      </div>
                      <div className="mt-1.5 text-[10.5px] leading-snug text-slate-500">
                        Cada dólar aportado volta com mais. Escolha quando o capital está{" "}
                        <b>disponível</b> e o que importa é o rendimento dele.
                      </div>
                    </div>
                    <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-4 py-3">
                      <div className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">
                        🏦 Mais dinheiro no bolso (Lucro)
                      </div>
                      <div className="mt-1 text-base font-bold text-slate-900">{bestProfit?.bankName ?? "—"}</div>
                      <div className="text-sm text-slate-700">
                        {bestProfit ? formatMoney(bestProfit.profit, "USD") : "—"} no projeto
                      </div>
                      <div className="mt-1.5 text-[10.5px] leading-snug text-slate-500">
                        Geralmente o banco mais barato. Escolha quando o objetivo é o{" "}
                        <b>resultado total</b>, não a velocidade.
                      </div>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-slate-100">
                          <th className={th}>Banco</th>
                          <th className={th}>
                            TIR
                            <Dot color={GREEN} />
                          </th>
                          <th className={th}>
                            ROI (lucro ÷ pico)
                            <Dot color={INDIGO} />
                          </th>
                          <th className={th}>
                            Lucro
                            <Dot color={AMBER} />
                          </th>
                          <th className={thRight}>Aporte (pico)</th>
                          <th className={thRight}>Custo do banco</th>
                          <th className={thRight}></th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((c) => (
                          <tr key={c.bankId} className="border-b border-slate-50">
                            <td className={`${td} font-medium text-slate-800`}>
                              {c.bankName}
                              {sim.bankProfileId === c.bankId && (
                                <span className="ml-2 text-xs text-slate-400">(atual)</span>
                              )}
                            </td>
                            <td className={td}>
                              <span className={c.irr === maxIrr ? "font-bold text-slate-900" : ""}>
                                {c.irr != null ? `${(c.irr * 100).toFixed(1)}%` : "—"}
                              </span>
                              {c.irr === maxIrr && <Dot color={GREEN} />}
                              <Bar pct={pctBar(c.irr, maxIrr)} color={GREEN} />
                            </td>
                            <td className={td}>
                              <span className={c.roi === maxRoi ? "font-bold text-slate-900" : ""}>
                                {c.roi != null ? `${(c.roi * 100).toFixed(1)}%` : "—"}
                              </span>
                              {c.roi === maxRoi && <Dot color={INDIGO} />}
                              {c.roi != null && (
                                <span className="ml-1 text-[10px] text-slate-400">{(1 + c.roi).toFixed(2)}x</span>
                              )}
                              <Bar pct={pctBar(c.roi, maxRoi)} color={INDIGO} />
                            </td>
                            <td className={td}>
                              <span className={`${c.profit === maxProfit ? "font-bold text-slate-900" : ""} ${c.profit < 0 ? "text-red-600" : ""}`}>
                                {formatMoney(c.profit, "USD")}
                              </span>
                              {c.profit === maxProfit && <Dot color={AMBER} />}
                              <Bar pct={pctBar(c.profit, maxProfit)} color={AMBER} />
                            </td>
                            <td className={tdRight}>
                              {formatMoney(c.peak, "USD")}
                              {(c.feesFinanced || (c.reserveFunded ?? 0) > 0) && (
                                <span
                                  className="block text-[10px] text-emerald-600"
                                  title="Fees/reserve rolados no loan não saem do caixa do investidor — por isso o aporte cai (e a TIR sobe) mesmo com custo total maior"
                                >
                                  {[
                                    c.feesFinanced ? "fees no loan" : null,
                                    (c.reserveFunded ?? 0) > 0 ? "reserve no loan" : null,
                                  ]
                                    .filter(Boolean)
                                    .join(" · ")}
                                </span>
                              )}
                            </td>
                            <td className={tdRight}>
                              {formatMoney(c.bankCost, "USD")}
                              {c.interest != null && (
                                <span className="block text-[10px] text-slate-400">
                                  juros {formatMoney(c.interest, "USD")} · closing {formatMoney(c.upfront ?? 0, "USD")}
                                  {(c.otherFees ?? 0) > 0 ? ` · taxas ${formatMoney(c.otherFees!, "USD")}` : ""}
                                  {(c.extFee ?? 0) > 0 ? ` · ext ${formatMoney(c.extFee!, "USD")}` : ""}
                                </span>
                              )}
                              {Math.abs(c.ctc ?? 0) > 0.01 && (
                                <span className={`block text-[10px] ${(c.ctc ?? 0) > 0 ? "text-emerald-600" : "text-red-500"}`}>
                                  cash to closing {formatMoney(c.ctc!, "USD")}
                                </span>
                              )}
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
                  <div className="mx-5 mb-4 rounded-r-lg border-l-2 border-slate-300 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <b className="text-slate-800">Como ler:</b> cada coluna tem seu campeão (bolinha
                    da cor da coluna) e as barras estão na escala do melhor de cada coluna — dá para
                    ver o quão perto os outros chegam. Capital escasso → decida pela TIR; capital
                    disponível → ROI e lucro pesam mais.
                  </div>
                </div>
              );
            })()}
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
                    {isCycled && <th className={th}>Ciclo</th>}
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
                      {isCycled && <td className={td}>C{u.cycle ?? 1}</td>}
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
                    <td className={`${td} font-semibold text-slate-800`} colSpan={isCycled ? 3 : 2}>
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
                    // quem limitou: o MENOR entre LTC e LTV (o financiado sai arredondado
                    // p/ baixo em $5k, então compara os tetos crus; "cap" = teto por unidade
                    // do perfil do banco, quando for menor que ambos)
                    const minCap = Math.min(u.bankLtcCap ?? Infinity, u.bankLtvCap ?? Infinity);
                    const binding =
                      u.bankEligible < minCap - 5000
                        ? "cap/unidade"
                        : (u.bankLtcCap ?? Infinity) <= (u.bankLtvCap ?? Infinity)
                          ? "LTC"
                          : "LTV";
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
            simName={sim.name}
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
