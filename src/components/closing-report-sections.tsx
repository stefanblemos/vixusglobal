import { formatMoney } from "@/lib/money";
import type { FinalReportData } from "@/lib/pools/report-month";
import type { Lang } from "@/lib/pools/i18n";
import { tOf } from "@/lib/pools/i18n";

// Seções do RELATÓRIO DE ENCERRAMENTO (06/10): derivado do mensal — entram no lugar das seções
// de projeção (marcação, risco, mercado). Tudo realizado. Server component, imprimível.

const h2 = "mt-6 mb-2 border-b border-slate-200 pb-1 text-[11px] font-bold uppercase tracking-wider text-[#1f3a5f] print:mt-4";
const pctS = (v: number | null) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

export function ClosingReportSections({
  final, currency, lang, fmtD,
}: {
  final: FinalReportData;
  currency: string;
  lang: Lang;
  fmtD: (iso: string | null) => string;
}) {
  const t = tOf(lang);
  const m = (v: number) => formatMoney(v, currency);
  const c = final.cascade;
  return (
    <>
      {/* 2 · resultado do projeto */}
      <h2 className={h2}>{t("rp.final.s2")}</h2>
      <div className="space-y-0.5 text-[12px] text-slate-700">
        {([
          ["rp.final.c.raised", c.raised, false],
          ["rp.final.c.houses", -c.equityToHouses, false],
          ["rp.final.c.sales", c.salesNet, false],
          ...(c.poolIncome > 0.005 ? [["rp.final.c.income", c.poolIncome, false]] : []),
          ...(c.poolExpenses > 0.005 ? [["rp.final.c.expenses", -c.poolExpenses, false]] : []),
          ...(c.performancePaid > 0.005 ? [["rp.final.c.perf", -c.performancePaid, false]] : []),
          ["rp.final.c.profit", c.profit, true],
        ] as Array<[string, number, boolean]>).map(([k, v, bold]) => (
          <div key={k} className={`flex justify-between ${bold ? "mt-1 border-t border-dashed border-slate-300 pt-1 text-[13px] font-extrabold text-slate-900" : ""}`}>
            <span>{t(k as never)}</span>
            <b className={`tabular-nums ${v < 0 && !bold ? "text-slate-500" : ""}`}>{v < 0 ? `−${m(-v)}` : m(v)}</b>
          </div>
        ))}
        <div className="mt-2 flex justify-between text-[11px] text-slate-500">
          <span>{t("rp.final.c.bank")}</span><b className="tabular-nums">{m(c.bankCosts)}</b>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
          {([["rp.final.c.distCap", c.distributedCapital], ["rp.final.c.distProfit", c.distributedProfit], ["rp.final.c.cash", c.cashLeft]] as Array<[string, number]>).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5">
              <div className="text-[8.5px] uppercase tracking-wider text-slate-400">{t(k as never)}</div>
              <div className="text-[13px] font-extrabold tabular-nums text-slate-900">{m(v)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 3 · casas — colunas separadas (pedido 06/10: "plan → real" na mesma célula ficava bagunçado) */}
      <h2 className={h2}>{t("rp.final.s3")}</h2>
      {(() => {
        const sum = (f: (h: FinalReportData["houses"][number]) => number | null) => final.houses.reduce((s, h) => s + (f(h) ?? 0), 0);
        const cell = (v: number | null, cls = "") => <td className={`whitespace-nowrap py-1 text-right tabular-nums ${cls}`}>{v == null ? "—" : v < 0 ? `−${m(-v)}` : m(v)}</td>;
        const dcell = (plan: number | null, real: number | null, goodWhenLower: boolean) => {
          if (plan == null || real == null) return <td className="py-1 text-right text-slate-300">—</td>;
          const d = real - plan;
          const good = goodWhenLower ? d <= 0 : d >= 0;
          return <td className={`whitespace-nowrap py-1 text-right text-[10.5px] tabular-nums ${Math.abs(d) < 0.005 ? "text-slate-400" : good ? "text-emerald-700" : "text-red-700"}`}>{d >= 0 ? "+" : "−"}{m(Math.abs(d))}</td>;
        };
        const plan = lang === "pt" ? "Plan." : "Plan";
        const real = lang === "pt" ? "Real" : "Actual";
        const group = "border-l border-slate-200 pl-2";
        return (
          <table className="w-full">
            <thead>
              <tr className="text-left text-[9px] uppercase tracking-wider text-slate-400">
                <th></th>
                <th colSpan={3} className={`pb-0.5 text-center ${group}`}>{lang === "pt" ? "Venda" : "Sale"}</th>
                <th colSpan={3} className={`pb-0.5 text-center ${group}`}>{lang === "pt" ? "Custo" : "Cost"}</th>
                <th colSpan={2} className={`pb-0.5 text-center ${group}`}>{lang === "pt" ? "Lucro" : "Profit"}</th>
                <th></th>
              </tr>
              <tr className="border-b border-slate-200 text-left text-[9.5px] uppercase tracking-wider text-slate-400">
                <th className="py-1 font-medium">{t("rp.final.h.home")}</th>
                <th className={`py-1 text-right font-medium ${group}`}>{plan}</th>
                <th className="py-1 text-right font-medium">{real}</th>
                <th className="py-1 text-right font-medium">Δ</th>
                <th className={`py-1 text-right font-medium ${group}`}>{plan}</th>
                <th className="py-1 text-right font-medium">{real}</th>
                <th className="py-1 text-right font-medium">Δ</th>
                <th className={`py-1 text-right font-medium ${group}`}>{plan}</th>
                <th className="py-1 text-right font-medium">{real}</th>
                <th className="py-1 text-right font-medium">{t("rp.final.h.closed")}</th>
              </tr>
            </thead>
            <tbody className="text-[11px] text-slate-700">
              {final.houses.map((h) => (
                <tr key={h.address} className="border-b border-slate-100">
                  <td className="py-1 font-medium">{h.address}</td>
                  {cell(h.plannedSale, `text-slate-500 ${group}`)}
                  {cell(h.soldPrice, "font-semibold")}
                  {dcell(h.plannedSale, h.soldPrice, false)}
                  {cell(h.plannedCost, `text-slate-500 ${group}`)}
                  {cell(h.realCost, "font-semibold")}
                  {dcell(h.plannedCost, h.realCost, true)}
                  {cell(h.profitPlanned, `text-slate-500 ${group}`)}
                  {cell(h.profitReal, `font-semibold ${h.profitReal != null && h.profitReal < 0 ? "text-red-700" : ""}`)}
                  <td className="whitespace-nowrap py-1 text-right text-slate-500">{fmtD(h.saleDate)}</td>
                </tr>
              ))}
              <tr className="font-bold text-slate-900">
                <td className="py-1">Total</td>
                {cell(sum((h) => h.plannedSale), group)}
                {cell(sum((h) => h.soldPrice))}
                {dcell(sum((h) => h.plannedSale), sum((h) => h.soldPrice), false)}
                {cell(sum((h) => h.plannedCost), group)}
                {cell(sum((h) => h.realCost))}
                {dcell(sum((h) => h.plannedCost), sum((h) => h.realCost), true)}
                {cell(sum((h) => h.profitPlanned), group)}
                {cell(sum((h) => h.profitReal))}
                <td></td>
              </tr>
            </tbody>
          </table>
        );
      })()}
      <p className="mt-1 text-[9.5px] text-slate-400">
        {lang === "pt"
          ? "Lucro por casa = venda − lote − obra − change orders − closing. Juros e fees do banco são do projeto (seção 2), não da casa."
          : "Profit per home = sale − lot − construction − change orders − closing. Bank interest and fees belong to the project (section 2), not to the home."}
      </p>

      {/* 4 · sócios */}
      <h2 className={h2}>{t("rp.final.s4")}</h2>
      {c.cashLeft > Math.max(500, c.raised * 0.005) && (
        <p className="mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800">
          {t("rp.final.cashNote", { cash: m(c.cashLeft) })}
        </p>
      )}
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-200 text-left text-[9.5px] uppercase tracking-wider text-slate-400">
            <th className="py-1 font-medium">{t("rp.final.m.member")}</th>
            <th className="py-1 text-right font-medium">%</th>
            <th className="py-1 text-right font-medium">{t("rp.final.m.invested")}</th>
            <th className="py-1 text-right font-medium">{t("rp.final.m.returned")}</th>
            <th className="py-1 text-right font-medium">{t("rp.final.m.profit")}</th>
            <th className="py-1 text-right font-medium">{t("rp.final.m.total")}</th>
            <th className="py-1 text-right font-medium">{t("rp.final.m.roi")}</th>
            <th className="py-1 text-right font-medium">{t("rp.final.m.irr")}</th>
          </tr>
        </thead>
        <tbody className="text-[11.5px] text-slate-700">
          {final.investors.map((r) => (
            <tr key={r.name} className="border-b border-slate-100">
              <td className="py-1 font-medium">{r.name}{r.role === "MANAGER" ? <span className="ml-1 text-[9px] text-slate-400">Manager</span> : null}</td>
              <td className="py-1 text-right tabular-nums text-slate-500">{(r.pct * 100).toFixed(2)}%</td>
              <td className="py-1 text-right tabular-nums">{m(r.invested)}</td>
              <td className="py-1 text-right tabular-nums">{m(r.returnedCapital)}</td>
              <td className="py-1 text-right tabular-nums">{m(r.profit)}</td>
              <td className="py-1 text-right font-bold tabular-nums">{m(r.total)}</td>
              <td className={`py-1 text-right tabular-nums ${r.roi != null && r.roi < 0 ? "text-red-700" : "text-emerald-700"}`}>{r.roi != null ? `${r.roi >= 0 ? "+" : ""}${(r.roi * 100).toFixed(2)}%` : "—"}</td>
              <td className="py-1 text-right tabular-nums">{pctS(r.irr)}</td>
            </tr>
          ))}
          <tr className="font-bold text-slate-900">
            <td className="py-1">Total</td>
            <td className="py-1 text-right">100%</td>
            <td className="py-1 text-right tabular-nums">{m(final.investors.reduce((s, r) => s + r.invested, 0))}</td>
            <td className="py-1 text-right tabular-nums">{m(final.investors.reduce((s, r) => s + r.returnedCapital, 0))}</td>
            <td className="py-1 text-right tabular-nums">{m(final.investors.reduce((s, r) => s + r.profit, 0))}</td>
            <td className="py-1 text-right tabular-nums">{m(final.investors.reduce((s, r) => s + r.total, 0))}</td>
            <td className="py-1 text-right tabular-nums">{(() => { const inv = final.investors.reduce((s, r) => s + r.invested, 0); const tot = final.investors.reduce((s, r) => s + r.total, 0); return inv > 0 ? `${tot / inv - 1 >= 0 ? "+" : ""}${((tot / inv - 1) * 100).toFixed(2)}%` : "—"; })()}</td>
            <td className="py-1 text-right tabular-nums">{pctS(final.projectIrr)}</td>
          </tr>
        </tbody>
      </table>

      {/* 5 · performance & distribuições */}
      <h2 className={h2}>{t("rp.final.s5")}</h2>
      <div className="space-y-1 text-[12px] text-slate-700">
        {final.performance.agreedPct == null ? (
          <p>{t("rp.final.perf.none")}</p>
        ) : (
          <>
            <div className="flex justify-between">
              <span>{t("rp.final.perf.agreed")}: <b>{final.performance.agreedPct}%</b> {t("rp.final.perf.ofProfit")}{final.performance.payee ? ` → ${final.performance.payee}` : ""}</span>
              <b className="tabular-nums">
                {t("rp.final.perf.paid")} {m(c.performancePaid)} · {t("rp.final.perf.waived")} {m(c.performanceWaived)}
                {c.performanceProvisioned > 0.005 ? ` · ${t("rp.final.perf.provisioned")} ${m(c.performanceProvisioned)}` : ""}
              </b>
            </div>
            {final.performance.decision && <p className="text-[11px] text-slate-500">{final.performance.decision}</p>}
          </>
        )}
        <div className="flex justify-between"><span>{t("rp.final.c.distCap")}</span><b className="tabular-nums">{m(c.distributedCapital)} / {m(c.raised)}</b></div>
        <div className="flex justify-between"><span>{t("rp.final.c.distProfit")}</span><b className="tabular-nums">{m(c.distributedProfit)}</b></div>
        <div className="flex justify-between"><span>{t("rp.final.c.cash")}</span><b className="tabular-nums">{m(c.cashLeft)}</b></div>
      </div>
      <p className="mt-3 text-[9.5px] text-slate-400">{t("rp.final.footer")}</p>
    </>
  );
}
