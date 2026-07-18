import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { PoolTabsNav } from "@/components/pool-tabs";
import { buildSimInput, type PromoteTierInput, type SimOverrides, type UnitRef } from "@/lib/pools/build-sim-input";
import { simulate } from "@/lib/pools/simulator";
import { NATURE_LABEL, provisionOf } from "@/lib/pools/provision";
import { buildRisk } from "@/lib/pools/risk";
import { RiskPanel } from "@/components/pool-risk-panel";

export const dynamic = "force-dynamic";

// Provisão & risco (16/07 provisão + Fase 2 risco, mocks aprovados): no topo, o painel
// de risco & caixa futuro (runway, juros hoje×pico, breakeven+stress, fila de
// distribuições — lib/pools/risk.ts, fonte única); abaixo, a provisão por cenário
// calculada AO VIVO da simulação de origem do pool, como antes.

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const thR = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-1.5 text-sm text-slate-600";
const tdR = "px-3 py-1.5 text-right text-sm tabular-nums text-slate-700";

export default async function PoolProvisionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ cenario?: string }>;
}) {
  const { id } = await params;
  const { cenario } = await searchParams;
  const pool = await prisma.investmentPool.findUnique({
    where: { id },
    include: {
      houses: true,
      members: { include: { entries: true } },
      distributions: true,
      expenses: true,
      loans: {
        orderBy: { createdAt: "asc" },
        include: {
          bankProfile: true,
          entries: true,
          documents: { select: { id: true, fileName: true, kind: true, extracted: true } },
        },
      },
    },
  });
  if (!pool) notFound();
  const sim = await prisma.poolSimulation.findFirst({ where: { poolId: id } });

  const risk = buildRisk(pool, new Date());
  const riskPanel = <RiskPanel risk={risk} currency={pool.currency} poolId={pool.id} />;

  if (!sim) {
    return (
      <div className="space-y-6">
        <Header pool={pool} />
        <PoolTabsNav poolId={pool.id} active="provision" />
        {riskPanel}
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          Este pool não tem simulação de origem vinculada — a provisão é calculada da simulação
          que o gerou.
        </div>
      </div>
    );
  }

  const scenarios = await prisma.bufferScenario.findMany({
    orderBy: { sortOrder: "asc" },
    select: { code: true, name: true },
  });
  const scenarioCode = scenarios.some((s) => s.code === cenario) ? cenario! : sim.scenarioCode;

  const input = await buildSimInput({
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
    scenarioCode,
    bankProfileId: sim.bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
    overrides: (sim.overrides as SimOverrides | null) ?? null,
    vehicleStructure: sim.vehicleStructure,
  });

  if ("error" in input) {
    return (
      <div className="space-y-6">
        <Header pool={pool} />
        <PoolTabsNav poolId={pool.id} active="provision" />
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          Não foi possível recalcular a simulação de origem: {input.error}
        </div>
      </div>
    );
  }

  const r = simulate(input);
  const p = provisionOf(r);
  const snapshot = pool.targetAmount == null ? null : Number(pool.targetAmount);
  const delta = snapshot == null ? null : p.total - snapshot;
  const maxCall = Math.max(...p.monthlyCalls.map((m) => m.amount), 1);
  const housesEquity = p.houses.reduce((s, h) => s + h.equityTotal, 0);
  const fmt0 = (v: number) => formatMoney(Math.round(v), pool.currency);

  return (
    <div className="space-y-6">
      <Header pool={pool} />
      <PoolTabsNav poolId={pool.id} active="provision" />
      {riskPanel}

      {/* seletor de cenário — o quadro vale para Real (padrão) e Estresse (colchão) */}
      <div className="flex flex-wrap items-center gap-2">
        {scenarios.map((s) => (
          <Link
            key={s.code}
            href={`/pools/${pool.id}/provision?cenario=${s.code}`}
            className={`rounded-full border px-3 py-1.5 text-sm transition ${
              scenarioCode === s.code
                ? "border-[#1f3a5f] bg-[#1f3a5f] font-medium text-white"
                : "border-slate-300 text-slate-600 hover:border-slate-400"
            }`}
          >
            {s.name}
            {s.code === sim.scenarioCode ? " (da conversão)" : ""}
          </Link>
        ))}
      </div>

      {/* ── Resumo: o valor + composição por natureza (mock aprovado) ── */}
      <section className="rounded-xl border border-slate-200 bg-white p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[#1f3a5f]">
              Provisão de recursos — por que este valor?
            </h2>
            <p className="text-xs text-slate-400">
              Soma das chamadas de capital do cenário {scenarios.find((s) => s.code === scenarioCode)?.name} da
              simulação {sim.name} · {r.units.length} casas · recalculado ao vivo pelo motor
            </p>
          </div>
          <div className="text-right">
            <div className="text-3xl font-extrabold tabular-nums text-[#1f3a5f]">{fmt0(p.total)}</div>
            <p className="text-xs text-slate-400">
              capital total chamado dos sócios · pico no D+{p.peakDay}
              {p.firstReturn ? ` · 1ª devolução no D+${p.firstReturn.day} (${fmt0(p.firstReturn.amount)})` : ""}
            </p>
            {snapshot != null && Math.abs(delta!) > 0.5 && (
              <p className="mt-1 text-[11px] text-amber-600">
                snapshot da conversão: {fmt0(snapshot)} · Δ {delta! > 0 ? "+" : "−"}
                {fmt0(Math.abs(delta!))} (motor/catálogo evoluíram desde a conversão)
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 flex h-9 overflow-hidden rounded-lg">
          {p.byNature.map((n) => (
            <div
              key={n.nature}
              style={{ width: `${Math.max(n.pct * 100, 0.3)}%`, background: NATURE_LABEL[n.nature].color }}
              title={`${NATURE_LABEL[n.nature].label}: ${fmt0(n.amount)}`}
              className="flex items-center justify-center whitespace-nowrap text-[11px] font-bold text-white"
            >
              {n.pct >= 0.12 ? `${NATURE_LABEL[n.nature].label} ${(n.pct * 100).toFixed(1)}%` : ""}
            </div>
          ))}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Para onde vai o dinheiro chamado</th>
                <th className={thR}>Valor</th>
                <th className={thR}>%</th>
                <th className={th}>Por que o sócio paga isso (e não o banco)</th>
              </tr>
            </thead>
            <tbody>
              {p.byNature.map((n) => (
                <tr key={n.nature} className="border-b border-slate-50">
                  <td className={td}>
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]"
                      style={{ background: NATURE_LABEL[n.nature].color }}
                    />
                    <b>{NATURE_LABEL[n.nature].label}</b>
                  </td>
                  <td className={tdR}>{fmt0(n.amount)}</td>
                  <td className={tdR}>{(n.pct * 100).toFixed(1)}%</td>
                  <td className="px-3 py-1.5 text-xs text-slate-400">{NATURE_LABEL[n.nature].why}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className={td}>Total da provisão</td>
                <td className={tdR}>{fmt0(p.total)}</td>
                <td className={tdR}>100%</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Explodido por casa — a sustentação ── */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-medium text-slate-800">Explodido por casa</h2>
          <p className="text-xs text-slate-400">
            A fatia de cada casa na provisão (lote + obra paga com equity); a obra do banco entra
            via draws e volta no payoff — não consome provisão.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Casa</th>
                <th className={thR}>Lote</th>
                <th className={thR}>Obra (equity)</th>
                <th className={thR}>Equity da casa</th>
                <th className={thR}>% da provisão</th>
                <th className={thR}>Obra (banco)</th>
                <th className={thR}>Venda (líq.)</th>
                <th className={thR}>Lote pago</th>
                <th className={thR}>Venda</th>
              </tr>
            </thead>
            <tbody>
              {p.houses.map((h) => (
                <tr key={h.label} className="border-b border-slate-50">
                  <td className={td}>
                    {h.count > 1 && <b>{h.count}× </b>}
                    {h.label}
                  </td>
                  <td className={tdR}>{fmt0(h.lot)}</td>
                  <td className={tdR}>{fmt0(h.buildEquity)}</td>
                  <td className={`${tdR} font-semibold`}>{fmt0(h.equityTotal)}</td>
                  <td className={tdR}>{p.total > 0 ? ((h.equityTotal / p.total) * 100).toFixed(1) : "—"}%</td>
                  <td className={`${tdR} text-slate-400`}>{fmt0(h.buildBank)}</td>
                  <td className={`${tdR} text-slate-400`}>{fmt0(h.saleNet)}</td>
                  <td className={`${tdR} text-slate-400`}>{h.lotCloseDay != null ? `D+${h.lotCloseDay}` : "—"}</td>
                  <td className={`${tdR} text-slate-400`}>{h.saleDay != null ? `D+${h.saleDay}` : "—"}</td>
                </tr>
              ))}
              <tr className="border-t border-slate-200 font-semibold">
                <td className={td}>Subtotal das casas</td>
                <td className={tdR}>{fmt0(p.houses.reduce((s, h) => s + h.lot, 0))}</td>
                <td className={tdR}>{fmt0(p.houses.reduce((s, h) => s + h.buildEquity, 0))}</td>
                <td className={tdR}>{fmt0(housesEquity)}</td>
                <td className={tdR}>{p.total > 0 ? ((housesEquity / p.total) * 100).toFixed(1) : "—"}%</td>
                <td colSpan={4} />
              </tr>
              {p.programLines.map((l) => (
                <tr key={l.nature} className="border-b border-slate-50 text-slate-500">
                  <td className={td}>
                    <span
                      className="mr-2 inline-block h-2.5 w-2.5 rounded-sm align-[-1px]"
                      style={{ background: NATURE_LABEL[l.nature].color }}
                    />
                    {NATURE_LABEL[l.nature].label} <span className="text-xs text-slate-400">(nível do programa)</span>
                  </td>
                  <td colSpan={2} />
                  <td className={tdR}>{fmt0(l.amount)}</td>
                  <td className={tdR}>{p.total > 0 ? ((l.amount / p.total) * 100).toFixed(1) : "—"}%</td>
                  <td colSpan={4} />
                </tr>
              ))}
              <tr className="border-t-2 border-[#1f3a5f]/30 font-bold">
                <td className={td}>Total da provisão</td>
                <td colSpan={2} />
                <td className={tdR}>{fmt0(p.total)}</td>
                <td className={tdR}>100%</td>
                <td colSpan={4} />
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ── Cronograma de chamadas ── */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-medium text-slate-800">Cronograma de chamadas (JIT)</h2>
          <p className="mb-3 text-xs text-slate-400">
            Cada chamada acontece só quando o caixa não cobre a próxima obrigação — o desembolso
            é escalonado.
          </p>
          <div className="flex h-28 items-end gap-1.5">
            {p.monthlyCalls.map((m) => (
              <div key={m.month} className="flex flex-1 flex-col items-center justify-end gap-1" title={fmt0(m.amount)}>
                <div className="text-[9px] tabular-nums text-slate-500">
                  {m.amount >= 1000 ? `${Math.round(m.amount / 1000)}k` : Math.round(m.amount)}
                </div>
                <div
                  className="w-full rounded-t bg-[#1f3a5f]"
                  style={{ height: `${Math.max((m.amount / maxCall) * 88, 2)}px` }}
                />
                <div className="text-[9px] text-slate-400">M{m.month}</div>
              </div>
            ))}
          </div>
          <table className="mt-3 w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Mês</th>
                <th className={thR}>Chamada</th>
                <th className={thR}>Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {p.monthlyCalls.map((m) => (
                <tr key={m.month} className="border-b border-slate-50">
                  <td className={td}>M{m.month}</td>
                  <td className={tdR}>{fmt0(m.amount)}</td>
                  <td className={tdR}>{fmt0(m.cumulative)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {/* ── Juros mês a mês — sustentação da linha de juros ── */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <h2 className="text-base font-medium text-slate-800">Juros do banco, mês a mês</h2>
          <p className="mb-3 text-xs text-slate-400">
            Juros sobre o saldo sacado enquanto as casas não vendem — é a sustentação da linha
            “Juros pagos em caixa” do resumo.
          </p>
          {p.monthlyInterest.length === 0 ? (
            <p className="text-sm text-slate-400">Sem juros neste cenário (programa 100% equity).</p>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={th}>Mês</th>
                  <th className={thR}>Juros no mês</th>
                  <th className={thR}>Acumulado</th>
                </tr>
              </thead>
              <tbody>
                {p.monthlyInterest.map((m) => (
                  <tr key={m.month} className="border-b border-slate-50">
                    <td className={td}>M{m.month}</td>
                    <td className={tdR}>{fmt0(m.amount)}</td>
                    <td className={tdR}>{fmt0(m.cumulative)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-5 text-sm text-slate-600">
        <h2 className="mb-2 text-base font-medium text-slate-800">Notas para os sócios</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Por que não menos?</b> A provisão é a soma das chamadas do cenário — o dia de maior
            exposição é o D+{p.peakDay}
            {p.firstReturn ? `, véspera da primeira devolução (D+${p.firstReturn.day})` : ""}. Com menos, o
            caixa quebra no meio da obra.
          </li>
          <li>
            <b>Por que não de uma vez?</b> Chamadas são just-in-time — capital parado não deprime a
            TIR e ninguém aporta antes do cronograma exigir.
          </li>
          <li>
            O quadro no <b>Cenário de Estresse</b> mostra a provisão com colchão — alterne no
            seletor acima.
          </li>
        </ul>
      </section>
    </div>
  );
}

function Header({ pool }: { pool: { id: string; code: string; alias: string | null } }) {
  return (
    <div>
      <Link href={`/pools/${pool.id}`} className="text-sm text-slate-500 hover:text-slate-700">
        ← {pool.code}
        {pool.alias ? ` · ${pool.alias}` : ""}
      </Link>
      <h1 className="mt-1 text-2xl font-semibold text-slate-800">Provisão &amp; risco</h1>
      <p className="text-sm text-slate-500">
        Risco &amp; caixa futuro do pool + o quadro que justifica o valor captado (calculado ao
        vivo da simulação de origem).
      </p>
    </div>
  );
}
