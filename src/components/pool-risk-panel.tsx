import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { mesAno, type RiskResult } from "@/lib/pools/risk";

// Painel "Risco & caixa futuro" (Fase 2, mock de tela aprovado 18/07): topo da aba
// Provisão & risco — runway, juros hoje×pico, breakeven+stress e fila de distribuições.
// Server component puro: toda a conta vem de lib/pools/risk.ts (fonte única).

const th = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400";
const thR = "px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400";
const td = "px-3 py-1.5 text-sm text-slate-600";
const tdR = "px-3 py-1.5 text-right text-sm tabular-nums text-slate-700";

const PILL: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  red: "bg-red-50 text-red-700",
  slate: "bg-slate-100 text-slate-500",
};
const Pill = ({ tone, children }: { tone: string; children: React.ReactNode }) => (
  <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${PILL[tone]}`}>{children}</span>
);

const fmtDate = (d: Date) =>
  `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;

export function RiskPanel({ risk, currency, poolId }: { risk: RiskResult; currency: string; poolId: string }) {
  const fmt = (v: number) => formatMoney(v, currency);
  const compact = (v: number) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency,
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(v);
    } catch {
      return String(Math.round(v));
    }
  };
  const runwayLabel =
    risk.runwayMonths == null
      ? "sem juros correndo"
      : `≈ ${risk.runwayMonths.toFixed(1).replace(".", ",")} ${risk.runwayMonths >= 2 ? "meses" : "mês"}`;
  const activeLoans = risk.loans.filter((l) => !l.quitado);

  return (
    <div className="space-y-4">
      {/* ── A · Runway & compromissos ── */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
          Runway &amp; compromissos
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          O caixa aguenta até quando? Juros sem interest reserve saem do caixa do pool todo mês.
        </p>
        <div className="mt-3 grid gap-5 lg:grid-cols-2">
          <div>
            <div className="space-y-0.5 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>Caixa disponível hoje</span>
                <b className="tabular-nums">{fmt(risk.freeCash)}</b>
              </div>
              <div className="flex justify-between">
                <span>
                  Juros/mês hoje —{" "}
                  {activeLoans
                    .filter((l) => l.monthlyToday > 0 || l.awaitingClosing)
                    .map((l) => `${l.label} ≈ ${fmt(l.monthlyToday)}`)
                    .join(" · ") || "nenhum"}
                </span>
                <b className="tabular-nums text-amber-700">
                  {risk.monthlyToday > 0 ? `≈ −${fmt(risk.monthlyToday)}/mês` : "—"}
                </b>
              </div>
              <div className="flex justify-between border-t border-dashed border-slate-200 pt-1 text-sm font-bold text-slate-800">
                <span>Runway</span>
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
                  {runwayLabel}
                  {risk.runwayMonths != null && risk.runwayMonths < 1 ? " — não cobre o próximo ciclo ⚠" : ""}
                </b>
              </div>
            </div>
            {(risk.callMin90d != null || risk.callSufficiency != null) && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50/70 px-3 py-2.5 text-[11.5px] text-amber-800">
                Capital call sugerido:{" "}
                {risk.callMin90d != null && (
                  <>
                    <b>≈ {fmt(risk.callMin90d)}</b> (90 dias de juros)
                  </>
                )}
                {risk.callMin90d != null && risk.callSufficiency != null && " · "}
                {risk.callSufficiency != null && (
                  <>
                    <b>{fmt(risk.callSufficiency)}</b> fecha a suficiência (equity que falta nas casas)
                  </>
                )}
                <div className="mt-2 flex items-center gap-2">
                  <Link
                    href={`/pools/${poolId}?tab=investors`}
                    className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-[11px] font-bold text-white hover:bg-[#2a4a75]"
                  >
                    Criar capital call →
                  </Link>
                  <span className="text-[10.5px] text-amber-700/80">
                    abre Investidores com o valor pré-preenchido
                  </span>
                </div>
              </div>
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={th}>Próximos desembolsos (est.)</th>
                  <th className={thR}>Valor</th>
                  <th className={thR}>Caixa após</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {risk.disbursements.length === 0 && (
                  <tr>
                    <td className={td} colSpan={4}>
                      Sem juros correndo — nenhum desembolso previsto.
                    </td>
                  </tr>
                )}
                {risk.disbursements.map((d) => (
                  <tr key={d.label} className="border-b border-slate-50">
                    <td className={`${td} text-xs`}>{d.label}</td>
                    <td className={tdR}>≈ {fmt(d.amount)}</td>
                    <td className={`${tdR} ${d.cashAfter < 0 ? "font-bold text-red-700" : ""}`}>
                      {d.cashAfter < 0 ? `−${fmt(Math.abs(d.cashAfter))}` : fmt(d.cashAfter)}
                    </td>
                    <td className="px-3 py-1.5">
                      {d.cashAfter < 0 ? (
                        <Pill tone="red">descoberto</Pill>
                      ) : d.cashAfter < d.amount ? (
                        <Pill tone="amber">apertado</Pill>
                      ) : (
                        <Pill tone="green">ok</Pill>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ── B · Juros hoje × pico ── */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
          Juros — hoje × pico
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          &quot;Por vir&quot; usa a média saldo hoje→pico até o payoff do baseline — a mesma conta da
          suficiência do financiamento.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Loan</th>
                <th className={thR}>Saldo hoje</th>
                <th className={thR}>Juros/mês hoje</th>
                <th className={thR}>Pico (tudo sacado)</th>
                <th className={thR}>Juros/mês no pico</th>
                <th className={thR}>Por vir até payoff</th>
              </tr>
            </thead>
            <tbody>
              {risk.loans.map((l) => (
                <tr key={l.label} className={`border-b border-slate-50 ${l.quitado ? "opacity-50" : ""}`}>
                  <td className={td}>
                    {l.label}
                    {l.aprPct != null && <span className="text-xs text-slate-400"> · {l.aprPct}%</span>}
                    <span className="text-xs text-slate-400"> · {l.houses} casa{l.houses === 1 ? "" : "s"}</span>
                    {l.quitado && (
                      <span className="ml-1.5">
                        <Pill tone="slate">quitado</Pill>
                      </span>
                    )}
                    {!l.quitado && l.awaitingClosing && (
                      <span className="ml-1.5">
                        <Pill tone="slate">aguard. closing</Pill>
                      </span>
                    )}
                  </td>
                  <td className={tdR}>{fmt(l.balance)}</td>
                  <td className={tdR}>≈ {fmt(l.monthlyToday)}</td>
                  <td className={tdR}>{fmt(l.peakPrincipal)}</td>
                  <td className={tdR}>≈ {fmt(l.monthlyPeak)}</td>
                  <td className={tdR}>≈ {compact(l.comingInterest)}</td>
                </tr>
              ))}
              <tr className="border-t-2 border-slate-200 font-bold text-slate-800">
                <td className={td}>Pool</td>
                <td className={tdR}>{fmt(risk.loans.reduce((s, l) => s + l.balance, 0))}</td>
                <td className={tdR}>≈ {fmt(risk.monthlyToday)}</td>
                <td className={tdR}>{fmt(risk.loans.reduce((s, l) => s + l.peakPrincipal, 0))}</td>
                <td className={tdR}>≈ {fmt(risk.monthlyPeak)}</td>
                <td className={tdR}>≈ {compact(risk.comingInterestTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* ── C · Breakeven & stress (só com base de custo+venda nas casas restantes) ── */}
      {risk.grossProfit <= 0 ? (
        <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
            Breakeven &amp; stress
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Sem base de custo × venda planejados nas casas restantes — breakeven e stress
            indisponíveis. Preencha os planejados na ficha da casa para habilitar.
          </p>
        </section>
      ) : (
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
          Breakeven &amp; stress
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Quanto pode dar errado antes de doer — lucro bruto {compact(risk.grossProfit)} − financiamento{" "}
          {compact(risk.financingDrag)} = líquido ≈ <b>{compact(risk.profitNet)}</b>
          {risk.breakevenPct != null && (
            <>
              {" "}
              → as vendas podem cair{" "}
              <b className="text-emerald-700">{risk.breakevenPct.toFixed(1)}%</b> antes do lucro zerar.
            </>
          )}
        </p>
        <div className="mt-2 grid gap-5 lg:grid-cols-2">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={th}>Cenário</th>
                  <th className={thR}>Lucro líq. ≈</th>
                  <th className={thR}>Δ vs plano</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {risk.scenarios.map((s) => (
                  <tr key={s.label} className="border-b border-slate-50">
                    <td className={td}>{s.label}</td>
                    <td className={`${tdR} ${s.profit < 0 ? "font-bold text-red-700" : ""}`}>
                      {s.profit < 0 ? `−${compact(Math.abs(s.profit))}` : compact(s.profit)}
                    </td>
                    <td className={`${tdR} text-slate-400`}>
                      {s.base ? "—" : `−${compact(Math.abs(s.delta))}`}
                    </td>
                    <td className="px-3 py-1.5">
                      <Pill tone={s.tone}>
                        {s.base ? "base" : s.tone === "red" ? "prejuízo" : s.tone === "amber" ? "atenção" : "ok"}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={th}>Casa — venda pode cair até…</th>
                  <th className={thR}>Venda plan.</th>
                  <th className={thR}>Margem</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {risk.margins.map((m) => (
                  <tr key={m.addr} className="border-b border-slate-50">
                    <td className={`${td} text-xs`}>{m.addr}</td>
                    <td className={tdR}>{compact(m.sale)}</td>
                    <td className={tdR}>{m.marginPct.toFixed(1)}%</td>
                    <td className="px-3 py-1.5">
                      <Pill tone={m.tone}>{m.tone === "red" ? "fina" : "ok"}</Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1.5 text-[10.5px] text-slate-400">
              margem antes do financiamento (o drag é do pool, não da casa)
            </p>
          </div>
        </div>
      </section>
      )}

      {/* ── D · Fila de distribuições estimadas ── */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
          Fila de distribuições estimadas
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">
          Vendas do baseline congelado, casa a casa — a 1ª linha alimenta o KPI &quot;Próx.
          distribuição&quot; da régua. Quando a casa vende de verdade, sai da fila (a distribuição
          real é lançada em Investidores › Distribuições).
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Quando</th>
                <th className={th}>Casa</th>
                <th className={thR}>Retorno de capital</th>
                <th className={thR}>Lucro líq. ≈</th>
                <th className={thR}>Total ≈</th>
                <th className={thR}>Acumulado</th>
              </tr>
            </thead>
            <tbody>
              {risk.queue.length === 0 && (
                <tr>
                  <td className={td} colSpan={6}>
                    Todas as casas vendidas — nada na fila.
                  </td>
                </tr>
              )}
              {risk.queue.map((q, i) => (
                <tr key={q.addr} className="border-b border-slate-50">
                  <td className={`${td} ${i === 0 ? "font-bold text-slate-800" : ""}`}>
                    {q.date ? fmtDate(q.date) : "sem data no baseline"}
                  </td>
                  <td className={`${td} text-xs`}>{q.addr}</td>
                  <td className={tdR}>{compact(q.capital)}</td>
                  <td className={tdR}>{compact(q.profit)}</td>
                  <td className={`${tdR} ${i === 0 ? "font-bold" : ""}`}>{compact(q.total)}</td>
                  <td className={`${tdR} text-slate-400`}>{compact(q.cumulative)}</td>
                </tr>
              ))}
              {risk.queue.length > 0 && (
                <tr className="border-t-2 border-slate-200 font-bold text-slate-800">
                  <td className={td} colSpan={2}>
                    Total projetado a devolver
                  </td>
                  <td className={tdR}>{compact(risk.queue.reduce((s, q) => s + q.capital, 0))}</td>
                  <td className={tdR}>{compact(risk.queue.reduce((s, q) => s + q.profit, 0))}</td>
                  <td className={tdR}>{compact(risk.queue.reduce((s, q) => s + q.total, 0))}</td>
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {risk.next?.date && (
          <p className="mt-1.5 text-[10.5px] text-slate-400">
            próxima: {mesAno(risk.next.date)} · ≈ {compact(risk.next.total)} — {risk.next.addr}
          </p>
        )}
      </section>
    </div>
  );
}
