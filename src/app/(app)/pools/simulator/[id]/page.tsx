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

      {/* Alavancas da simulação viva: cenário, funding e remuneração recalculam na hora */}
      <SimulationControls
        sim={{
          id: sim.id,
          scenarioCode: sim.scenarioCode,
          fundingMode: sim.fundingMode,
          bankProfileId: sim.bankProfileId,
          compMode: sim.compMode,
          perfPct: Number(sim.perfPct).toString(),
          perfTiming: sim.perfTiming,
          flatFeePerHouse: Number(sim.flatFeePerHouse).toString(),
        }}
        scenarios={allScenarios}
        banks={allBanks}
      />

      {/* A mesma simulação nos 3 cenários — o em exibição destacado */}
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
              <h2 className="text-base font-medium text-slate-800">
                Ledger de simulação{isBank ? " — capital próprio × banco" : ""}
              </h2>
              <p className="text-xs text-slate-400">
                {isBank
                  ? "O dinheiro do banco entra no caixa e sai pagando a obra (duas linhas); fees e reserve capitalizam no saldo do loan. Contas pagas do caixa (verde) não geram aporte."
                  : "Todos os eventos datados — o extrato prospectivo enviado ao investidor. Contas pagas do caixa (verde) não geram aporte."}
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
                    {isBank && <th className={thRight}>Δ loan</th>}
                    <th className={thRight}>Caixa</th>
                    {isBank && <th className={thRight}>Saldo loan</th>}
                    <th className={thRight}>Capital investidor</th>
                  </tr>
                </thead>
                <tbody>
                  {r.events.map((e, i) => {
                    // regra do caixa-primeiro visível: gasto sem aporte no mesmo dia = verde
                    const paidFromCash =
                      e.amount < 0 &&
                      e.kind !== "RETURN" &&
                      e.kind !== "BANK_PAYOFF" &&
                      !injectionDays.has(e.day);
                    return (
                    <tr
                      key={i}
                      className={`border-b border-slate-50 ${
                        e.kind === "INJECTION"
                          ? "bg-red-50/40"
                          : e.kind === "RETURN"
                            ? "bg-emerald-50/40"
                            : paidFromCash
                              ? "bg-emerald-50/20"
                              : e.kind === "BANK_DRAW"
                                ? "bg-blue-50/30"
                                : ""
                      }`}
                    >
                      <td className={td}>D+{e.day}</td>
                      <td className={td}>
                        <span className="text-xs text-slate-500">{KIND_LABEL[e.kind] ?? e.kind}</span>
                      </td>
                      <td className={`${td} text-slate-500`}>
                        {e.label}
                        {paidFromCash && (
                          <span className="ml-1 text-xs text-emerald-600" title="Havia caixa — nenhum aporte foi necessário">
                            · pago do caixa
                          </span>
                        )}
                      </td>
                      <td className={`${tdRight} ${e.amount < 0 ? "text-slate-700" : e.amount > 0 ? "text-emerald-700" : "text-slate-300"}`}>
                        {e.amount !== 0 ? formatMoney(e.amount, "USD") : "—"}
                      </td>
                      {isBank && (
                        <td className={`${tdRight} ${(e.bankAmount ?? 0) < 0 ? "text-emerald-700" : "text-slate-500"}`}>
                          {e.bankAmount ? formatMoney(e.bankAmount, "USD") : ""}
                        </td>
                      )}
                      <td className={tdRight}>{formatMoney(e.cash, "USD")}</td>
                      {isBank && (
                        <td className={`${tdRight} font-medium`}>{formatMoney(e.bankBalance, "USD")}</td>
                      )}
                      <td className={tdRight}>{formatMoney(e.invested, "USD")}</td>
                    </tr>
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
