import { formatMoney } from "@/lib/money";

/**
 * Suficiência do financiamento no Statement (mock aprovado 17/07):
 * 1) painel por LOAN — todas as casas com necessário × disponível e Falta/Sobra, somatório
 *    no rodapé, e o líquido confrontado com os custos ainda por vir;
 * 2) resumo GERAL do pool — todos os loans juntos (escolha do Stefan: um cobre o outro).
 * Componentes server puros — os números chegam prontos da página.
 */

export type SuffRow = {
  addr: string;
  obra: number | null;
  equity: number | null;
  necessario: number | null;
  disponivel: number | null;
  delta: number | null;
};

export type SuffAgg = {
  loanId: string;
  label: string;
  quitado: boolean;
  rows: SuffRow[];
  liquido: number;
  jurosEst: number;
  mesesRest: number;
  aprL: number | null;
  drawFeeEst: number;
  closingPend: number;
  custosPorVir: number;
  resultado: number;
};

const th = "px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-slate-400";
const tdRight = "px-3 py-2 text-right text-sm tabular-nums text-slate-700";

const delta = (v: number | null, cur: string) =>
  v == null ? (
    <span className="text-slate-300">—</span>
  ) : v >= 0 ? (
    <span className="font-bold text-emerald-700">+{formatMoney(v, cur)}</span>
  ) : (
    <span className="font-bold text-red-700">−{formatMoney(-v, cur)}</span>
  );

function CostLines({ a, cur }: { a: SuffAgg; cur: string }) {
  const line = (l: string, v: number) =>
    v > 0.01 ? (
      <div className="flex justify-between text-xs text-slate-600">
        <span>{l}</span>
        <span className="tabular-nums">≈ −{formatMoney(v, cur)}</span>
      </div>
    ) : null;
  return (
    <div className="mt-1.5 space-y-0.5">
      {line(
        `Provisão de juros até o payoff (${a.aprL ?? "?"}% · ~${a.mesesRest} ${a.mesesRest === 1 ? "mês" : "meses"} · APR/12 × média do sacado)`,
        a.jurosEst,
      )}
      {line("Fees de draw futuros (≈ 4 draws/casa)", a.drawFeeEst)}
      {line("Cobranças de closing ainda não lançadas (Documentos)", a.closingPend)}
    </div>
  );
}

export function LoanSufficiencyPanel({ a, cur }: { a: SuffAgg; cur: string }) {
  if (a.rows.length === 0 || a.quitado) return null;
  const sum = (f: (r: SuffRow) => number | null) => a.rows.reduce((s, r) => s + (f(r) ?? 0), 0);
  const ok = a.resultado >= 0;
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-3">
        <h2 className="text-base font-medium text-slate-800">Suficiência do financiamento — {a.label}</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10.5px] font-bold ${a.liquido >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}
        >
          líquido {a.liquido >= 0 ? "+" : "−"}
          {formatMoney(Math.abs(a.liquido), cur)}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className={th}>Casa</th>
              <th className={thRight}>Obra estimada</th>
              <th className={thRight}>− Equity p/ obra</th>
              <th className={thRight}>= Necessário</th>
              <th className={thRight}>Disponível (loan)</th>
              <th className={thRight}>Falta / Sobra</th>
            </tr>
          </thead>
          <tbody>
            {a.rows.map((r) => (
              <tr key={r.addr} className="border-b border-slate-50">
                <td className="px-3 py-2 text-sm font-semibold text-slate-700">{r.addr}</td>
                <td className={tdRight}>{r.obra != null ? formatMoney(r.obra, cur) : "—"}</td>
                <td className={tdRight}>{r.equity != null && r.equity > 0 ? formatMoney(r.equity, cur) : "—"}</td>
                <td className={tdRight}>{r.necessario != null ? formatMoney(r.necessario, cur) : "—"}</td>
                <td className={tdRight}>{r.disponivel != null ? formatMoney(r.disponivel, cur) : "—"}</td>
                <td className="px-3 py-2 text-right text-sm">{delta(r.delta, cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="px-3 pb-3 pt-2.5 text-sm font-bold text-slate-800">
                Total ({a.rows.length} {a.rows.length === 1 ? "casa" : "casas"})
              </td>
              <td className={`${tdRight} border-t-2 border-slate-200 font-bold`}>{formatMoney(sum((r) => r.obra), cur)}</td>
              <td className={`${tdRight} border-t-2 border-slate-200 font-bold`}>{formatMoney(sum((r) => r.equity), cur)}</td>
              <td className={`${tdRight} border-t-2 border-slate-200 font-bold`}>{formatMoney(sum((r) => r.necessario), cur)}</td>
              <td className={`${tdRight} border-t-2 border-slate-200 font-bold`}>{formatMoney(sum((r) => r.disponivel), cur)}</td>
              <td className="border-t-2 border-slate-200 px-3 py-2 text-right text-sm">{delta(a.liquido, cur)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="px-5 pb-4">
        <div className={`rounded-xl border px-4 py-3 ${ok ? "border-emerald-200 bg-emerald-50/60" : "border-red-200 bg-red-50/60"}`}>
          <p className={`text-sm font-bold ${ok ? "text-emerald-700" : "text-red-700"}`}>
            {a.liquido >= 0
              ? `✓ Sobra líquida de ${formatMoney(a.liquido, cur)}`
              : `⚠ Falta líquida de ${formatMoney(-a.liquido, cur)}`}
            {a.custosPorVir > 0.01 ? " — confrontando com os custos ainda por vir:" : ""}
          </p>
          <CostLines a={a} cur={cur} />
          {a.custosPorVir > 0.01 && (
            <div className={`mt-1.5 flex justify-between border-t border-dashed pt-1.5 text-sm font-bold ${ok ? "border-emerald-200 text-emerald-700" : "border-red-200 text-red-700"}`}>
              <span>{ok ? "Folga final estimada" : "Aporte estimado dos sócios"}</span>
              <span className="tabular-nums">
                {ok ? "+" : "−"}
                {formatMoney(Math.abs(a.resultado), cur)}
              </span>
            </div>
          )}
          <p className="mt-1 text-[10.5px] text-slate-400">
            Necessário = obra estimada − aporte próprio além do lote · disponível = drawable −
            closing consumido (rateio). Sobras de uma casa cobrem faltas de outras no mesmo loan.
          </p>
        </div>
      </div>
    </section>
  );
}

export function PoolSufficiencySummary({ aggs, cur }: { aggs: SuffAgg[]; cur: string }) {
  const active = aggs.filter((a) => !a.quitado && a.rows.length > 0);
  if (active.length === 0) return null;
  const total = active.reduce((s, a) => s + a.resultado, 0);
  const liquidoTotal = active.reduce((s, a) => s + a.liquido, 0);
  const custosTotal = active.reduce((s, a) => s + a.custosPorVir, 0);
  const ok = total >= 0;
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-base font-medium text-slate-800">Resumo geral — todos os loans do pool</h2>
        <p className="text-xs text-slate-400">
          As sobras de um loan cobrem as faltas do outro — a conta que importa é a do pool.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className={th}>Loan</th>
              <th className={thRight}>Líquido das casas</th>
              <th className={thRight}>Custos por vir (juros/fees/closing)</th>
              <th className={thRight}>Resultado</th>
            </tr>
          </thead>
          <tbody>
            {active.map((a) => (
              <tr key={a.loanId} className="border-b border-slate-50">
                <td className="px-3 py-2 text-sm font-semibold text-slate-700">{a.label}</td>
                <td className="px-3 py-2 text-right text-sm">{delta(a.liquido, cur)}</td>
                <td className={tdRight}>{a.custosPorVir > 0.01 ? `≈ −${formatMoney(a.custosPorVir, cur)}` : "—"}</td>
                <td className="px-3 py-2 text-right text-sm">{delta(a.resultado, cur)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td className="px-3 pb-3 pt-2.5 text-sm font-bold text-slate-800">Total geral</td>
              <td className="border-t-2 border-slate-200 px-3 py-2 text-right text-sm">{delta(liquidoTotal, cur)}</td>
              <td className={`${tdRight} border-t-2 border-slate-200 font-bold`}>
                {custosTotal > 0.01 ? `≈ −${formatMoney(custosTotal, cur)}` : "—"}
              </td>
              <td className="border-t-2 border-slate-200 px-3 py-2 text-right text-sm">{delta(total, cur)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="px-5 pb-4">
        <div className={`rounded-xl px-4 py-2.5 text-sm font-bold ${ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
          {ok
            ? `✓ No conjunto, o financiamento cobre obra + custos por vir — folga estimada de ${formatMoney(total, cur)}`
            : `⚠ No conjunto faltam ${formatMoney(-total, cur)} — aporte dos sócios necessário`}
        </div>
      </div>
    </section>
  );
}
