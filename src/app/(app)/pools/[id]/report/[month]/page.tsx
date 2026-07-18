import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { buildMonthlyReport, type ReportMonthData } from "@/lib/pools/report-month";
import { INV_LANG_COOKIE, langFromCookie, mesAnoLang, tOf } from "@/lib/pools/i18n";
import { LangToggle } from "@/components/lang-toggle";
import { UnitValueChart } from "@/components/unit-value-chart";
import { PrintButton, PublishReportForm } from "@/components/report-toolbar";

export const dynamic = "force-dynamic";

// Report mensal do pool (Fase 5, mock aprovado 19/07): página imprimível bilíngue.
// Publicado → renderiza o snapshot CONGELADO (PoolDocument.data); senão, prévia viva.
// Publicação: sob demanda, narrativa editável; cai no Data room (Reports, Portal).

const monthShift = (month: string, delta: number) => {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};

export default async function MonthlyReportPage({
  params,
}: {
  params: Promise<{ id: string; month: string }>;
}) {
  const { id, month } = await params;
  if (!/^\d{4}-\d{2}$/.test(month)) notFound();
  const lang = langFromCookie((await cookies()).get(INV_LANG_COOKIE)?.value);
  const t = tOf(lang);
  const dateLocale = (await headers()).get("accept-language")?.split(",")[0]?.trim() || "en-US";

  const published = await prisma.poolDocument.findFirst({
    where: { poolId: id, reportMonth: month },
    select: { data: true, createdAt: true },
  });
  const data = published?.data
    ? (published.data as unknown as ReportMonthData)
    : await buildMonthlyReport(id, month, lang);
  if (!data) notFound();
  const cur = data.currency;

  const fmtD = (isoStr: string | null) => {
    if (!isoStr) return "—";
    try {
      return new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC" }).format(new Date(isoStr));
    } catch {
      return isoStr.slice(0, 10);
    }
  };
  const compact = (v: number) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: cur,
        notation: "compact",
        maximumFractionDigits: 1,
      }).format(v);
    } catch {
      return formatMoney(v, cur);
    }
  };
  const monthDate = new Date(`${month}-01T00:00:00Z`);
  const k = data.kpis;
  const navDelta =
    k.navPerUnit != null && k.navPerUnitPrev != null ? k.navPerUnit - k.navPerUnitPrev : null;

  const kpis: Array<{ label: string; value: string; hint: string; hero: boolean }> = [
    {
      label: "NAV / unit",
      hero: true,
      value: k.navPerUnit != null ? formatMoney(k.navPerUnit, cur) : "—",
      hint:
        navDelta != null
          ? `${t("rp.k.nav.h")} ${formatMoney(k.navPerUnitPrev!, cur)} (${navDelta >= 0 ? "+" : "−"}${formatMoney(Math.abs(navDelta), cur)})`
          : `par ${formatMoney(k.unitPar, cur)}`,
    },
    {
      label: "TIR",
      hero: true,
      value: k.irrLive != null ? `${(k.irrLive * 100).toFixed(1)}%` : "—",
      hint: k.irrPlan != null ? `plano ${(k.irrPlan * 100).toFixed(1)}%` : "",
    },
    {
      label: t("rp.k.obra"),
      hero: false,
      value: `${k.housesStarted}/${k.housesTotal}`,
      hint: `${t("rp.k.obra.h")}: ${k.sold}`,
    },
    {
      label: t("rp.k.raised"),
      hero: false,
      value: k.pctRaised != null ? `${k.pctRaised}%` : compact(k.raised),
      hint: k.target != null ? `${compact(k.raised)} / ${compact(k.target)}` : compact(k.raised),
    },
    {
      label: t("rp.k.next"),
      hero: false,
      value: k.nextDist ? mesAnoLang(new Date(`${k.nextDist.month}-01T00:00:00Z`), lang) : "—",
      hint: k.nextDist ? `≈ ${compact(k.nextDist.total)} · ${k.nextDist.addr}` : "",
    },
    {
      label: t("rp.k.runway"),
      hero: false,
      value:
        k.runwayMonths != null ? `${k.runwayMonths.toFixed(1).replace(".", ",")} ${lang === "pt" ? "mês(es)" : "mo"}` : "—",
      hint: k.runwayMonths != null && k.runwayMonths < 1 ? "⚠" : "",
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* barra da plataforma — some na impressão */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-2.5 print:hidden">
        <Link href={`/pools/${id}?tab=investors&sub=dataroom`} className="text-xs text-slate-400 hover:text-slate-600">
          ← Data room
        </Link>
        <Link
          href={`/pools/${id}/report/${monthShift(month, -1)}`}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          ← {mesAnoLang(new Date(`${monthShift(month, -1)}-01T00:00:00Z`), lang)}
        </Link>
        <span className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-bold text-white">
          {mesAnoLang(monthDate, lang)}
        </span>
        <Link
          href={`/pools/${id}/report/${monthShift(month, 1)}`}
          className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          {mesAnoLang(new Date(`${monthShift(month, 1)}-01T00:00:00Z`), lang)} →
        </Link>
        <span
          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${
            published ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
          }`}
        >
          {published ? `✓ ${t("rp.published")}` : t("rp.preview")}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <PublishReportForm
            poolId={id}
            month={month}
            defaultNarrative={data.narrative}
            publishLabel={published ? t("rp.republish") : t("rp.publish")}
            narrativeLabel={t("rp.narrative.label")}
            lang={lang}
          />
          <PrintButton label={t("rp.print")} />
          <LangToggle lang={lang} />
        </div>
      </div>

      {/* o documento */}
      <div className="rounded-2xl border border-slate-200 bg-white px-8 py-6 print:border-0 print:px-0">
        <div className="flex items-end justify-between border-b-[3px] border-[#1f3a5f] pb-3">
          <div className="text-xl font-black tracking-wide text-[#1f3a5f]">
            VIXUS <span className="text-amber-700">· 4U</span>
          </div>
          <div className="text-right">
            <div className="text-[15px] font-extrabold text-slate-800">
              {t("rp.title")} — {data.poolName}
            </div>
            <div className="text-[11px] text-slate-400">
              {mesAnoLang(monthDate, lang)} · {t("rp.generated")} {fmtD(data.generatedAt)} ·{" "}
              {t("rp.dataUntil")} {fmtD(data.cutoff)}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {kpis.map((kk) => (
            <div
              key={kk.label}
              className={`rounded-xl border px-3 py-2 ${kk.hero ? "border-[#1f3a5f]/25 bg-slate-50" : "border-slate-200 bg-white"}`}
            >
              <div className="text-[8.5px] uppercase tracking-wider text-slate-400">{kk.label}</div>
              <div className="text-[14px] font-extrabold tabular-nums text-slate-900">{kk.value}</div>
              <div className="truncate text-[8.5px] text-slate-400">{kk.hint}</div>
            </div>
          ))}
        </div>

        {/* 1 · resumo */}
        <h2 className={h2}>{t("rp.s1")}</h2>
        <p className="text-[13px] leading-relaxed text-slate-700">{data.narrative}</p>
        <div className="mt-2 space-y-0.5">
          {data.events.slice(0, 10).map((e, i) => (
            <div key={i} className="flex items-baseline gap-2 text-[12px] text-slate-600">
              <span className="w-16 shrink-0 tabular-nums text-[10px] text-slate-400">{fmtD(e.date)}</span>
              <span className="shrink-0">{e.icon}</span>
              <span>{e.text}</span>
            </div>
          ))}
        </div>

        {/* 2 · marcação */}
        <h2 className={h2}>{t("rp.s2")}</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <UnitValueChart
            par={data.chart.par}
            todayValue={data.chart.today}
            endValue={data.chart.end}
            startLabel={data.chart.startLabel ? fmtD(data.chart.startLabel).slice(0, 10) : ""}
            todayLabel={mesAnoLang(monthDate, lang)}
            endLabel={data.chart.endLabel ? fmtD(data.chart.endLabel).slice(0, 10) : ""}
            parLabel={`par ${formatMoney(data.chart.par, cur)}`}
            caption={t("iv.chart.caption")}
          />
          <div className="space-y-0.5 text-[11.5px] text-slate-600">
            {data.cascade.map((l) => (
              <div key={l.key} className="flex justify-between">
                <span>{t(`iv.cas.${l.key}` as "iv.cas.cash")}</span>
                <b className={`tabular-nums ${l.amount < 0 ? "text-amber-700" : ""}`}>
                  {l.amount < 0 ? "−" : ""}
                  {compact(Math.abs(l.amount))}
                </b>
              </div>
            ))}
            {data.chart.end != null && (
              <div className="flex justify-between border-t border-dashed border-slate-200 pt-1 font-bold text-slate-800">
                <span>{t("iv.cas.total")}</span>
                <b className="tabular-nums">{formatMoney(data.chart.end, cur)}/unit</b>
              </div>
            )}
          </div>
        </div>

        {/* 3 · cronograma */}
        <h2 className={h2}>{t("rp.s3")}</h2>
        {data.schedule.length === 0 ? (
          <p className="text-[12px] text-slate-400">{t("rp.sched.empty")}</p>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>{t("rp.c.house")}</th>
                <th className={th}>{t("rp.c.milestone")}</th>
                <th className={thR}>{t("rp.c.baseline")}</th>
                <th className={thR}>{t("rp.c.actual")}</th>
                <th className={thR}>Δ</th>
              </tr>
            </thead>
            <tbody>
              {data.schedule.map((s, i) => (
                <tr key={i} className="border-b border-slate-50">
                  <td className={td}>{s.house}</td>
                  <td className={td}>{s.milestone}</td>
                  <td className={tdR}>{fmtD(s.baseline)}</td>
                  <td className={tdR}>{s.real ? fmtD(s.real) : "—"}</td>
                  <td className={tdR}>
                    {s.late ? (
                      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold text-red-700">
                        {t("rp.late")}
                      </span>
                    ) : s.deltaDays != null ? (
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          s.deltaDays <= 0
                            ? "bg-emerald-50 text-emerald-700"
                            : s.deltaDays <= 15
                              ? "bg-emerald-50 text-emerald-700"
                              : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {s.deltaDays > 0 ? `+${s.deltaDays}d` : `${s.deltaDays}d`}
                      </span>
                    ) : (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">
                        {t("rp.onTime")}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* 4 · risco & caixa */}
        <h2 className={h2}>{t("rp.s4")}</h2>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-0.5 text-[11.5px] text-slate-600">
            <div className="flex justify-between">
              <span>{t("rp.risk.runway")}</span>
              <b
                className={`tabular-nums ${
                  k.runwayMonths != null && k.runwayMonths < 2 ? "text-red-700" : "text-slate-800"
                }`}
              >
                {k.runwayMonths != null
                  ? `≈ ${k.runwayMonths.toFixed(1).replace(".", ",")} ${lang === "pt" ? "mês(es)" : "mo"}${k.runwayMonths < 1 ? " ⚠" : ""}`
                  : "—"}
              </b>
            </div>
            <div className="flex justify-between">
              <span>{t("rp.risk.interest")}</span>
              <b className="tabular-nums">≈ {formatMoney(data.risk.monthlyInterest, cur)}</b>
            </div>
            {(data.risk.callMin != null || data.risk.callSuff != null) && (
              <div className="flex justify-between">
                <span>{t("rp.risk.call")}</span>
                <b className="tabular-nums">
                  {data.risk.callMin != null ? `${compact(data.risk.callMin)} (90d)` : ""}
                  {data.risk.callMin != null && data.risk.callSuff != null ? " · " : ""}
                  {data.risk.callSuff != null ? compact(data.risk.callSuff) : ""}
                </b>
              </div>
            )}
            <div className="flex justify-between">
              <span>{t("rp.risk.breakeven")}</span>
              <b className="tabular-nums text-emerald-700">
                {data.risk.breakevenPct != null ? `≈ ${data.risk.breakevenPct.toFixed(1)}%` : "—"}
              </b>
            </div>
          </div>
          <table className="w-full self-start">
            <tbody>
              {data.risk.stress.map((s) => (
                <tr key={s.label} className="border-b border-slate-50">
                  <td className={td}>{s.label}</td>
                  <td className={`${tdR} ${s.profit < 0 ? "font-bold text-red-700" : ""}`}>
                    {s.profit < 0 ? `−${compact(Math.abs(s.profit))}` : compact(s.profit)}
                  </td>
                  <td className="px-2 py-1 text-right">
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        s.tone === "red"
                          ? "bg-red-50 text-red-700"
                          : s.tone === "amber"
                            ? "bg-amber-50 text-amber-700"
                            : "bg-emerald-50 text-emerald-700"
                      }`}
                    >
                      {s.tone === "red" ? "⚠" : s.tone === "amber" ? "△" : "✓"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 5 · mercado */}
        <h2 className={h2}>{t("rp.s5")}</h2>
        <div className="flex justify-between text-[11.5px] text-slate-600">
          <span>{t("rp.market.lights")}</span>
          <b>
            {data.market.green} ✓ · {data.market.amber} △ · {data.market.red} ⚠
            {data.market.notes.length > 0 ? ` — ${data.market.notes.join(" · ")}` : ""}
          </b>
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{t("rp.market.note")}</p>

        {/* 6 · distribuições */}
        <h2 className={h2}>{t("rp.s6")}</h2>
        <div className="space-y-0.5 text-[11.5px] text-slate-600">
          <div className="flex justify-between">
            <span>{t("rp.dist.inMonth")}</span>
            <b className="tabular-nums">
              {formatMoney(data.dist.inMonth, cur)} / {formatMoney(data.dist.cumulative, cur)}
            </b>
          </div>
          <div className="flex justify-between">
            <span>{t("rp.dist.queue")}</span>
            <b className="tabular-nums">
              {t("rp.dist.queueVal", {
                n: data.dist.queueCount,
                total: compact(data.dist.queueTotal),
                cap: compact(data.dist.queueCapital),
                profit: compact(data.dist.queueProfit),
              })}
            </b>
          </div>
        </div>

        <div className="mt-6 flex justify-between border-t-2 border-slate-200 pt-2 text-[9.5px] text-slate-400">
          <span>
            Vixus Global · 4U Custom Homes — {t("rp.title")} · {data.poolName} · {mesAnoLang(monthDate, lang)}
          </span>
          <span>{t("rp.footer.disclaimer")}</span>
        </div>
      </div>
    </div>
  );
}

const h2 =
  "mt-5 mb-2 border-b border-slate-200 pb-1 text-[11px] font-bold uppercase tracking-wider text-[#1f3a5f]";
const th = "px-2 py-1.5 text-left text-[9px] font-bold uppercase tracking-wide text-slate-400";
const thR = "px-2 py-1.5 text-right text-[9px] font-bold uppercase tracking-wide text-slate-400";
const td = "px-2 py-1 text-[11.5px] text-slate-600";
const tdR = "px-2 py-1 text-right text-[11.5px] tabular-nums text-slate-600";
