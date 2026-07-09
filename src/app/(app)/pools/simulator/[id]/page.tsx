import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import {
  compareSimulationBanks,
  convertSimulationToPool,
  deleteSimulation,
  rerunSimulation,
  useComparedBank,
} from "@/lib/actions/simulations";
import type { SimResult } from "@/lib/pools/simulator";

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
  BANK_FEE: "Fee banco",
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
  best?: boolean;
};

export default async function SimulationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const sim = await prisma.poolSimulation.findUnique({
    where: { id },
    include: { scenario: true, bankProfile: true, pool: true },
  });
  if (!sim) notFound();
  const r = sim.result as unknown as (SimResult & { comparison?: CompareRow[] }) | null;
  const comparison = r?.comparison ?? null;
  const allBanks = await prisma.bankProfile.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

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

      {!r ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          No result stored — re-run the simulation.
        </div>
      ) : (
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

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {sim.compMode === "PERFORMANCE" ? (
              <Card label="Performance 4U" value={formatMoney(r.kpis.perfFeeTotal, "USD")} hint="antes do split" />
            ) : sim.compMode === "PROMOTE" ? (
              <Card label="Promote 4U" value={formatMoney(r.kpis.perfFeeTotal, "USD")} hint="waterfall por tiers" />
            ) : (
              <Card label="Contractor fee 4U" value={formatMoney(r.kpis.contractorFeeTotal, "USD")} />
            )}
            {sim.fundingMode === "BANK" && (
              <>
                <Card label="Loan comprometido" value={formatMoney(r.kpis.bankCommitted, "USD")} />
                <Card label="Fees upfront do banco" value={formatMoney(r.kpis.bankUpfrontFees, "USD")} />
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
              <Card label="Equity gate" value={formatMoney(r.kpis.equityGateAmount, "USD")} hint={`${Number(sim.equityGatePct)}% dos custos`} />
            )}
          </div>

          {/* Comparador de bancos: mesma cesta de casas, N perfis, melhor opção marcada */}
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
            <form action={compareSimulationBanks} className="flex flex-wrap items-center gap-4 border-t border-slate-100 px-5 py-4">
              <input type="hidden" name="simulationId" value={sim.id} />
              {allBanks.map((b) => (
                <label key={b.id} className="flex items-center gap-1.5 text-sm text-slate-600">
                  <input type="checkbox" name="bankIds" value={b.id} defaultChecked={comparison?.some((c) => c.bankId === b.id) ?? false} />
                  {b.name}
                </label>
              ))}
              <button
                type="submit"
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
              >
                ⚖ Comparar
              </button>
            </form>
          </section>

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
                </tbody>
              </table>
            </div>
          </section>

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

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-medium text-slate-800">Ledger de simulação</h2>
              <p className="text-xs text-slate-400">
                Todos os eventos datados — o extrato prospectivo enviado ao investidor.
              </p>
            </div>
            <div className="max-h-160 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 bg-white">
                  <tr className="border-b border-slate-100">
                    <th className={th}>Dia</th>
                    <th className={th}>Tipo</th>
                    <th className={th}>Evento</th>
                    <th className={thRight}>Valor</th>
                    <th className={thRight}>Caixa</th>
                    <th className={thRight}>Capital investidor</th>
                  </tr>
                </thead>
                <tbody>
                  {r.events.map((e, i) => (
                    <tr
                      key={i}
                      className={`border-b border-slate-50 ${
                        e.kind === "INJECTION" ? "bg-red-50/40" : e.kind === "RETURN" ? "bg-emerald-50/40" : ""
                      }`}
                    >
                      <td className={td}>D+{e.day}</td>
                      <td className={td}>
                        <span className="text-xs text-slate-500">{KIND_LABEL[e.kind] ?? e.kind}</span>
                      </td>
                      <td className={`${td} text-slate-500`}>{e.label}</td>
                      <td className={`${tdRight} ${e.amount < 0 ? "text-slate-700" : "text-emerald-700"}`}>
                        {formatMoney(e.amount, "USD")}
                      </td>
                      <td className={tdRight}>{formatMoney(e.cash, "USD")}</td>
                      <td className={tdRight}>{formatMoney(e.invested, "USD")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
