import Link from "next/link";
import { formatMoney } from "@/lib/money";
import { type InvestorPortfolio, type PortfolioPosition } from "@/lib/pools/investor-portfolio";
import { tOf, mesAnoLang, type Lang } from "@/lib/pools/i18n";
import { LangToggle } from "@/components/lang-toggle";
import { UnitValueChart } from "@/components/unit-value-chart";

// Visão consolidada do investidor (#59/#62) — render COMPARTILHADO entre:
//  · app interno: /pools/investors/[key] ("ver como investidor", operador)
//  · portal: home do investidor logado, escopada à entidade dele (#68)
// O que muda entre os dois é só a navegação: backHref, tabHref e o link "ver projeto"
// (que aponta pro pool interno e NÃO deve aparecer para o investidor).

const STATUS_STYLE: Record<string, string> = {
  FUNDING: "bg-amber-50 text-amber-700",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  CLOSING: "bg-blue-50 text-blue-700",
  CLOSED: "bg-slate-100 text-slate-500",
};

const VTABS = ["overview", "statement", "tax"] as const;

export type InvestorTaxDoc = {
  id: string;
  docType: string;
  fileName: string;
  createdAt: Date;
  signedAt: Date | null;
  pdfSize: number | null;
  pool: { code: string };
};

export function InvestorPortfolioView({
  p,
  lang,
  dateLocale,
  vtab,
  taxDocs,
  backHref,
  tabHref,
  showProjectLink = true,
  legacyPanel = null,
}: {
  p: InvestorPortfolio;
  lang: Lang;
  dateLocale: string;
  vtab: string;
  taxDocs: InvestorTaxDoc[];
  backHref: string | null;
  tabHref: (tab: string) => string;
  showProjectLink?: boolean;
  /** painel admin do saldo de abertura — só a tela interna passa (nunca o portal) */
  legacyPanel?: React.ReactNode;
}) {
  const t = tOf(lang);
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
  const fmtFull = (d: Date) => {
    try {
      return new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC" }).format(d);
    } catch {
      return d.toISOString().slice(0, 10);
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
          {backHref && (
            <Link href={backHref} className="text-xs text-slate-400 hover:text-slate-600">
              ←
            </Link>
          )}
          <h1 className="text-lg font-bold text-slate-800">{p.name}</h1>
          <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-500">
            {p.positions.length} {t("iv.active")}
          </span>
          {p.statement.firstDate && (
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] text-slate-500">
              {t("st.since")}{" "}
              {new Intl.DateTimeFormat(dateLocale, { timeZone: "UTC" }).format(p.statement.firstDate)}
            </span>
          )}
          <div className="ml-auto flex items-center gap-1.5">
            {VTABS.map((tb) => (
              <Link
                key={tb}
                href={tabHref(tb)}
                className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                  vtab === tb
                    ? "border-[#1f3a5f] bg-[#1f3a5f] text-white"
                    : "border-slate-300 text-slate-500 hover:bg-slate-50"
                }`}
              >
                {t(`st.tab.${tb}` as "st.tab.overview")}
              </Link>
            ))}
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

      {vtab === "overview" && (
        <>
          {/* cards por pool */}
          <div className="grid gap-4 lg:grid-cols-2">
            {p.positions.map((pos) => (
              <PositionCard key={pos.poolId} pos={pos} lang={lang} dateLocale={dateLocale} showProjectLink={showProjectLink} />
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
        </>
      )}

      {/* ── Extrato "conta bancária" (regra da carteira, aprovado 19/07) ── */}
      {vtab === "statement" && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {(() => {
              const s = p.statement;
              const unrealized = round0(p.valueToday - s.investedNow);
              const ks: Array<{ label: string; value: string; hint: string; hero: boolean }> = [
                {
                  label: t("st.k.new"),
                  value: formatMoney(s.newCapital, cur),
                  hint: t("st.k.new.h"),
                  hero: true,
                },
                {
                  label: t("st.k.recycled"),
                  value: formatMoney(s.recycled, cur),
                  hint: t("st.k.recycled.h"),
                  hero: false,
                },
                {
                  label: t("st.k.returned"),
                  value: formatMoney(s.returned, cur),
                  hint: t("st.k.returned.h"),
                  hero: false,
                },
                {
                  label: t("st.k.gain"),
                  value: `≈ ${unrealized + s.realizedProfit >= 0 ? "+" : "−"}${compact(Math.abs(unrealized + s.realizedProfit))}`,
                  hint: `${compact(s.realizedProfit)} · ≈ ${compact(unrealized)}`,
                  hero: true,
                },
                {
                  label: t("iv.k.irr"),
                  value: p.irr != null ? `≈ ${(p.irr * 100).toFixed(1)}%` : "—",
                  hint: t("iv.k.irr.h"),
                  hero: true,
                },
                s.wallet > 0.01
                  ? {
                      label: t("st.k.wallet"),
                      value: formatMoney(s.wallet, cur),
                      hint: t("st.k.wallet.h"),
                      hero: false,
                    }
                  : {
                      label: t("iv.k.today"),
                      value: `≈ ${compact(p.valueToday)}`,
                      hint: `${formatMoney(s.investedNow, cur)} ${t("st.c.invested").toLowerCase()}`,
                      hero: false,
                    },
              ];
              return ks.map((k) => (
                <div
                  key={k.label}
                  className={`rounded-xl border px-3 py-2 ${k.hero ? "border-[#1f3a5f]/25 bg-slate-50" : "border-slate-200 bg-white"}`}
                >
                  <div className="text-[9px] uppercase tracking-wider text-slate-400">{k.label}</div>
                  <div className="text-[15px] font-extrabold tabular-nums text-slate-900">{k.value}</div>
                  <div className="truncate text-[9px] text-slate-400">{k.hint}</div>
                </div>
              ));
            })()}
          </div>

          <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
              {t("st.title")}
            </h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={sTh}>Data</th>
                    <th className={sTh}>{t("st.c.event")}</th>
                    <th className={sTh}>{t("st.c.pool")}</th>
                    <th className={sThR}>{t("st.c.outPocket")}</th>
                    <th className={sThR}>{t("st.c.reused")}</th>
                    <th className={sThR}>{t("st.c.received")}</th>
                    <th className={sThR}>{t("st.c.invested")}</th>
                    <th className={sTh} />
                  </tr>
                </thead>
                <tbody>
                  {p.statement.rows.map((r, i) => (
                    <tr key={i} className={`border-b border-slate-50 ${r.legacy ? "bg-slate-50/60" : ""}`}>
                      <td className={`${sTd} tabular-nums`}>{fmtFull(r.date)}</td>
                      <td className={sTd}>{t(`st.ev.${r.kind}` as "st.ev.CONTRIBUTION")}</td>
                      <td className={sTd}>{r.poolCode}</td>
                      <td className={`${sTdR} ${r.outNew > 0 ? "text-amber-700" : "text-slate-300"}`}>
                        {r.outNew > 0 ? `−${formatMoney(r.outNew, cur)}` : "—"}
                      </td>
                      <td className={`${sTdR} ${r.outReused > 0 ? "" : "text-slate-300"}`}>
                        {r.outReused > 0 ? `−${formatMoney(r.outReused, cur)}` : "—"}
                      </td>
                      <td className={`${sTdR} ${r.received > 0 ? "font-bold text-emerald-700" : "text-slate-300"}`}>
                        {r.received > 0 ? `+${formatMoney(r.received, cur)}` : "—"}
                      </td>
                      <td className={sTdR}>{formatMoney(r.investedAfter, cur)}</td>
                      <td className="px-3 py-1.5">
                        <span className="flex flex-wrap items-center gap-1">
                        {r.rollover && <Tag tone="navy">{t("st.tag.rollover")}</Tag>}
                        {r.override && <Tag tone="amber">{t("st.tag.override")}</Tag>}
                        {r.legacy && <Tag tone="slate">{t("st.tag.opening")}</Tag>}
                        {!r.rollover && !r.override && r.outNew > 0 && r.outReused > 0 && (
                          <Tag tone="navy">{`${t("st.tag.reuse")} + ${t("st.tag.new")}`}</Tag>
                        )}
                        {!r.rollover && !r.override && r.outNew > 0 && r.outReused === 0 && (
                          <Tag tone="navy">{t("st.tag.new")}</Tag>
                        )}
                        {!r.rollover && !r.override && r.outNew === 0 && r.outReused > 0 && (
                          <Tag tone="green">{t("st.tag.reuse")}</Tag>
                        )}
                        </span>
                      </td>
                    </tr>
                  ))}
                  {/* projeções (fila líquida das Fases 2/4) — itálico, somem quando o real
                      acontece; data no passado (pool atrasado) clampa em "hoje" */}
                  {p.positions.flatMap((pos) => {
                    const now = new Date();
                    const clamp = (d: Date) => (d.getTime() < now.getTime() ? now : d);
                    const out: Array<{ date: Date; label: string; amount: number; code: string }> = [];
                    if (pos.nextDist)
                      out.push({
                        date: clamp(pos.nextDist.date),
                        label: t("st.proj.next"),
                        amount: pos.nextDist.share,
                        code: pos.code,
                      });
                    const rem = (pos.endShareNet ?? 0) - (pos.nextDist?.share ?? 0);
                    if (rem > 0.01 && pos.endDate)
                      out.push({ date: clamp(pos.endDate), label: t("st.proj.end"), amount: rem, code: pos.code });
                    return out;
                  })
                    .sort((a, b) => a.date.getTime() - b.date.getTime())
                    .map((f, i) => (
                      <tr key={`f${i}`} className="border-b border-slate-50 italic opacity-60">
                        <td className={`${sTd} tabular-nums`}>{mesAnoLang(f.date, lang)}</td>
                        <td className={sTd}>{f.label}</td>
                        <td className={sTd}>{f.code}</td>
                        <td className={sTdR}>—</td>
                        <td className={sTdR}>—</td>
                        <td className={`${sTdR} text-emerald-700`}>≈ +{compact(f.amount)}</td>
                        <td className={sTdR}>—</td>
                        <td className="px-3 py-1.5">
                          <Tag tone="slate">{t("st.tag.proj")}</Tag>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[10.5px] text-slate-400">{t("st.rule")}</p>
          </section>
          {legacyPanel}
        </>
      )}

      {/* ── Tax center: K-1/1099 por sócio (PoolDocument.memberId) ── */}
      {vtab === "tax" && (
        <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
            {t("tax.title")}
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">{t("tax.desc")}</p>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className={sTh}>{t("tax.c.year")}</th>
                  <th className={sTh}>{t("tax.c.doc")}</th>
                  <th className={sTh}>{t("tax.c.source")}</th>
                  <th className={sThR} />
                </tr>
              </thead>
              <tbody>
                {taxDocs.map((d) => (
                  <tr key={d.id} className="border-b border-slate-50">
                    <td className={`${sTd} tabular-nums`}>
                      {(d.signedAt ?? d.createdAt).getUTCFullYear()}
                    </td>
                    <td className={sTd}>
                      {d.pdfSize != null ? (
                        <a href={`/api/pool-docs/${d.id}/pdf`} target="_blank" className="text-[#1f3a5f] hover:underline">
                          {d.fileName}
                        </a>
                      ) : (
                        d.fileName
                      )}
                      <span className="ml-1.5 rounded-full bg-[#e8eef7] px-2 py-0.5 text-[10px] font-bold text-[#1f3a5f]">
                        {d.docType.replace(/_/g, " ")}
                      </span>
                    </td>
                    <td className={sTd}>{d.pool.code}</td>
                    <td className={sTdR} />
                  </tr>
                ))}
                {taxDocs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="px-3 py-4 text-sm text-slate-400">
                      {t("tax.empty")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10.5px] text-slate-400">{t("tax.k1note")}</p>
        </section>
      )}
    </div>
  );
}

const sTh = "px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400";
const sThR = "px-3 py-2 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400";
const sTd = "px-3 py-1.5 text-sm text-slate-600";
const sTdR = "px-3 py-1.5 text-right text-sm tabular-nums text-slate-700";
const round0 = (v: number) => Math.round(v * 100) / 100;

const TAG_TONE: Record<string, string> = {
  navy: "bg-[#e8eef7] text-[#1f3a5f]",
  green: "bg-emerald-50 text-emerald-700",
  amber: "bg-amber-50 text-amber-700",
  slate: "bg-slate-100 text-slate-500",
};
function Tag({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-bold ${TAG_TONE[tone]}`}>
      {children}
    </span>
  );
}

function PositionCard({ pos, lang, dateLocale, showProjectLink }: { pos: PortfolioPosition; lang: Lang; dateLocale: string; showProjectLink: boolean }) {
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
        {showProjectLink && (
          <Link href={`/pools/${pos.poolId}`} className="ml-auto text-[11px] text-slate-400 hover:text-slate-600">
            {t("iv.viewPool")}
          </Link>
        )}
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

      {/* TIR e ROI da POSIÇÃO em destaque (nota do Stefan 19/07: não estavam claros) */}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-[#1f3a5f]/25 bg-slate-50 px-3 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-slate-400">{t("iv.pos.irr")}</div>
          <div className="text-[15px] font-extrabold tabular-nums text-slate-900">
            {pos.irr != null ? `≈ ${(pos.irr * 100).toFixed(1)}%` : "—"}
          </div>
        </div>
        <div className="rounded-lg border border-[#1f3a5f]/25 bg-slate-50 px-3 py-1.5">
          <div className="text-[9px] uppercase tracking-wider text-slate-400">{t("iv.pos.roi")}</div>
          <div className="text-[15px] font-extrabold tabular-nums text-slate-900">
            {pos.roiProjected != null
              ? `${pos.roiProjected.toFixed(2)}× · ${pos.roiProjected >= 1 ? "+" : "−"}${Math.abs((pos.roiProjected - 1) * 100).toFixed(1)}%`
              : "—"}
          </div>
        </div>
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