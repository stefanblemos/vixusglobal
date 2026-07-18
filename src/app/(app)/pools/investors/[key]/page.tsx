import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies, headers } from "next/headers";
import { formatMoney } from "@/lib/money";
import { loadInvestorPortfolio, type PortfolioPosition } from "@/lib/pools/investor-portfolio";
import { INV_LANG_COOKIE, langFromCookie, tOf, mesAnoLang, type Lang } from "@/lib/pools/i18n";
import { LangToggle } from "@/components/lang-toggle";
import { UnitValueChart } from "@/components/unit-value-chart";

export const dynamic = "force-dynamic";

// Fase 4 (mock v2 aprovado): a tela do investidor — portfólio inteiro em um lugar só.
// Régua par → hoje (NAV conservador) → fim (projeção líquida A MERCADO) com cascata
// aberta. Hoje: admin "ver como investidor"; amanhã: a home do portal com login.

const STATUS_STYLE: Record<string, string> = {
  FUNDING: "bg-amber-50 text-amber-700",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  CLOSING: "bg-blue-50 text-blue-700",
  CLOSED: "bg-slate-100 text-slate-500",
};

export default async function InvestorPortfolioPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const lang = langFromCookie((await cookies()).get(INV_LANG_COOKIE)?.value);
  const t = tOf(lang);
  const dateLocale = (await headers()).get("accept-language")?.split(",")[0]?.trim() || "en-US";
  const p = await loadInvestorPortfolio(key);
  if (!p) notFound();

  const cur = p.positions[0]?.currency ?? "USD";
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
  const fmtDate = (d: Date) => {
    try {
      return new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC", month: "2-digit", year: "numeric" }).format(d);
    } catch {
      return d.toISOString().slice(0, 7);
    }
  };

  const kpis: Array<{ label: string; value: string; hint: string; hero: boolean }> = [
    {
      label: t("iv.k.invested"),
      value: formatMoney(p.invested, cur),
      hint: p.positions.map((x) => `${x.code} ${compact(x.invested)}`).join(" · "),
      hero: true,
    },
    { label: t("iv.k.today"), value: `≈ ${compact(p.valueToday)}`, hint: t("iv.k.today.h"), hero: true },
    { label: t("iv.k.end"), value: `≈ ${compact(p.endNet)}`, hint: t("iv.k.end.h"), hero: true },
    {
      label: t("iv.k.dist"),
      value: formatMoney(p.distributed, cur),
      hint: p.nextDist
        ? `${t("iv.k.next")}: ${fmtDate(p.nextDist.date)} ≈ ${compact(p.nextDist.share)} (${p.nextDist.poolCode})`
        : "—",
      hero: false,
    },
    {
      label: t("iv.k.irr"),
      value: p.irr != null ? `≈ ${(p.irr * 100).toFixed(1)}%` : "—",
      hint: t("iv.k.irr.h"),
      hero: false,
    },
    {
      label: t("iv.k.tvpi"),
      value: `${p.tvpiToday != null ? `${p.tvpiToday.toFixed(2)}×` : "—"} → ${
        p.tvpiProjected != null ? `≈${p.tvpiProjected.toFixed(2)}×` : "—"
      }`,
      hint: t("iv.k.tvpi.h"),
      hero: false,
    },
  ];

  return (
    <div className="space-y-4">
      {/* header sticky do investidor */}
      <div className="sticky top-0 z-10 -mx-1 rounded-2xl border border-slate-200 bg-white/95 px-5 py-4 shadow-sm backdrop-blur">
        <div className="mb-2.5 flex flex-wrap items-center gap-3">
          <Link href="/pools/investors" className="text-xs text-slate-400 hover:text-slate-600">
            ←
          </Link>
          <h1 className="text-lg font-bold text-slate-800">{p.name}</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-500">
            {p.positions.length} {t("iv.active")}
          </span>
          <div className="ml-auto">
            <LangToggle lang={lang} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
          {kpis.map((k) => (
            <div
              key={k.label}
              className={`rounded-xl border px-3 py-2 ${k.hero ? "border-[#1f3a5f]/25 bg-slate-50" : "border-slate-200 bg-white"}`}
            >
              <div className="text-[9px] uppercase tracking-wider text-slate-400">{k.label}</div>
              <div className="text-[15px] font-extrabold tabular-nums text-slate-900">{k.value}</div>
              <div className="truncate text-[9px] text-slate-400">{k.hint}</div>
            </div>
          ))}
        </div>
      </div>

      {/* cards por pool */}
      <div className="grid gap-4 lg:grid-cols-2">
        {p.positions.map((pos) => (
          <PositionCard key={pos.poolId} pos={pos} lang={lang} dateLocale={dateLocale} />
        ))}
      </div>

      {/* atividade consolidada */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
          {t("iv.activity")}
        </h2>
        <p className="mt-0.5 text-xs text-slate-400">{t("iv.activity.note")}</p>
        <div className="mt-2 space-y-0.5">
          {p.feed.events.map((e, i) => (
            <div key={`${e.date.toISOString()}-${i}`} className="flex items-baseline gap-2 text-[12px] text-slate-600">
              <span className="w-24 shrink-0 tabular-nums text-[10.5px] text-slate-400">
                {`${String(e.date.getUTCMonth() + 1).padStart(2, "0")}/${String(e.date.getUTCDate()).padStart(2, "0")} · ${e.poolCode}`}
              </span>
              <span className="shrink-0">{e.icon}</span>
              <span className="truncate">{e.text}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function PositionCard({ pos, lang, dateLocale }: { pos: PortfolioPosition; lang: Lang; dateLocale: string }) {
  const t = tOf(lang);
  const cur = pos.currency;
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
  const fmtMY = (d: Date | null) => {
    if (!d) return "—";
    try {
      return new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC", month: "2-digit", year: "numeric" }).format(d);
    } catch {
      return d.toISOString().slice(0, 7);
    }
  };
  const allSold = pos.soldCount === pos.housesCount && pos.housesCount > 0;
  return (
    <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <span className="text-sm font-extrabold text-slate-800">{pos.name}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_STYLE[pos.status] ?? ""}`}>
          {pos.status}
        </span>
        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
          {pos.soldCount}/{pos.housesCount} {t("iv.sold")}
        </span>
        <Link href={`/pools/${pos.poolId}`} className="ml-auto text-[11px] text-slate-400 hover:text-slate-600">
          {t("iv.viewPool")}
        </Link>
      </div>
      <div className="space-y-0.5 text-[12px] text-slate-600">
        <div className="flex justify-between">
          <span>{t("iv.stake")}</span>
          <b className="tabular-nums text-slate-800">
            {pos.units.toFixed(pos.units % 1 === 0 ? 0 : 1)} units ({(pos.pct * 100).toFixed(1)}%) ·{" "}
            {formatMoney(pos.invested, cur)}
          </b>
        </div>
        <div className="flex justify-between">
          <span>{allSold || pos.soldCount === 0 ? t("iv.valueToday") : t("iv.valueToday.unsold")}</span>
          <b className="tabular-nums text-slate-800">
            {pos.valueToday != null ? `≈ ${formatMoney(pos.valueToday, cur)}` : "—"}
          </b>
        </div>
        <div className="flex justify-between border-t border-dashed border-slate-200 pt-1 font-bold text-slate-900">
          <span>{t("iv.projEnd")}</span>
          <b className="tabular-nums">{pos.endShareNet != null ? `≈ ${formatMoney(pos.endShareNet, cur)}` : "—"}</b>
        </div>
        {pos.nextDist && (
          <div className="flex justify-between">
            <span>{t("iv.nextDist")}</span>
            <b className="tabular-nums">
              {mesAnoLang(pos.nextDist.date, lang)} · ≈ {compact(pos.nextDist.share)}
            </b>
          </div>
        )}
      </div>

      <div className="mt-2">
        <UnitValueChart
          par={pos.unitPar}
          todayValue={pos.navPerUnit}
          endValue={pos.endPerUnitNet}
          startLabel={pos.startDate ? fmtMY(pos.startDate) : t("iv.chart.start")}
          todayLabel={t("iv.chart.today")}
          endLabel={pos.endDate ? fmtMY(pos.endDate) : t("iv.chart.end")}
          parLabel={`${t("iv.chart.par")} ${formatMoney(pos.unitPar, cur)}`}
          caption={t("iv.chart.caption")}
          projectionColor={pos.status === "CLOSING" ? "#b45309" : "#1f3a5f"}
        />
      </div>

      {/* cascata "como chegamos" — transparência da conta */}
      {pos.endPerUnitNet != null && (
        <details className="mt-2 rounded-lg bg-slate-50 px-3 py-2">
          <summary className="cursor-pointer text-[11px] font-bold text-[#1f3a5f]">
            {t("iv.how")} ≈ {formatMoney(pos.endPerUnitNet, cur)}/unit
          </summary>
          <div className="mt-1.5 space-y-0.5 text-[11px] text-slate-600">
            {pos.endNet.lines.map((l) => (
              <div key={l.key} className="flex justify-between">
                <span>{t(`iv.cas.${l.key}` as "iv.cas.cash")}</span>
                <b className={`tabular-nums ${l.amount < 0 ? "text-amber-700" : ""}`}>
                  {l.amount < 0 ? "−" : ""}
                  {compact(Math.abs(l.amount))}
                </b>
              </div>
            ))}
            <div className="flex justify-between border-t border-dashed border-slate-200 pt-1 font-bold text-slate-800">
              <span>{t("iv.cas.total")}</span>
              <b className="tabular-nums">
                {compact(pos.endNet.endValueNet)} → {formatMoney(pos.endPerUnitNet, cur)}/unit
              </b>
            </div>
            {pos.endNet.flagsNoBenchmark.length > 0 && (
              <p className="pt-1 text-[10px] text-amber-700">
                ⚠ {pos.endNet.flagsNoBenchmark.join(" · ")}: {t("iv.noBenchmark")}
              </p>
            )}
            {pos.endNet.windDownEstimated && (
              <p className="pt-0.5 text-[10px] text-slate-400">{t("iv.windDownSuggest")}</p>
            )}
          </div>
        </details>
      )}
    </section>
  );
}
