import Link from "next/link";
import { Landmark, ClipboardCheck, CalendarClock, FolderOpen, Layers, PiggyBank, Bell, type LucideIcon } from "lucide-react";
import { buildOverview } from "@/lib/overview/data";
import { buildConsolidation } from "@/lib/consolidation/build";
import { buildReserveByEntity } from "@/lib/tax/reserve";
import { buildDigest } from "@/lib/digest/build";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const isoToShort = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });

export default async function DashboardPage() {
  const o = await buildOverview();
  // Cockpit financeiro do grupo — dos mesmos builders das telas de detalhe (catch → não derruba a home).
  const [consol, reserve, digest] = await Promise.all([
    buildConsolidation(o.year).catch(() => null),
    buildReserveByEntity(o.year).catch(() => null),
    buildDigest(o.year).catch(() => null),
  ]);
  const m = (n: number) => formatMoney(n, "USD");

  const bankIssues = o.bank.outOfBalance + o.bank.flagged;

  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Overview</h1>
          <p className="text-sm text-slate-500">
            {o.counts.companies} monitored companies · {o.counts.owners} owners · {o.counts.loans}{" "}
            intercompany loans · closing year {o.year}
          </p>
        </div>
      </div>

      {/* 0 — Group at a glance (cockpit) */}
      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Group at a glance — {o.year}
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Kpi
            href="/consolidation"
            icon={Layers}
            label="Consolidated net income"
            value={consol ? m(consol.consolidated.netIncome) : "—"}
            sub={consol ? `assets ${m(consol.consolidated.assets)}` : "not available"}
            accent
          />
          <Kpi
            href="/reserve"
            icon={PiggyBank}
            label="Tax to set aside"
            value={reserve ? m(reserve.totalReserve) : "—"}
            sub="group reserve (federal + state)"
          />
          <Kpi
            href="/digest"
            icon={Bell}
            label="Alerts"
            value={digest ? String(digest.alerts.length) : "—"}
            sub={digest ? `${digest.counts.alta} high priority` : "not available"}
            tone={digest && digest.counts.alta > 0 ? "danger" : "ok"}
          />
        </div>
      </section>

      {/* 1 — Needs attention */}
      <section className="space-y-2">
        <h2 className="text-xs font-medium uppercase tracking-wide text-slate-400">
          Needs attention
        </h2>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Attention
            href="/bank"
            icon={Landmark}
            label="Reconciliation"
            value={bankIssues}
            tone={bankIssues > 0 ? "danger" : "ok"}
            sub={`${o.bank.outOfBalance} out of balance · ${o.bank.flagged} missing`}
          />
          <Attention
            href="/closing"
            icon={ClipboardCheck}
            label={`Closing ${o.year}`}
            value={`${o.closing.complete}/${o.closing.existing}`}
            tone={o.closing.complete < o.closing.existing ? "warn" : "ok"}
            sub="companies complete"
          />
          <Attention
            href="/obligations"
            icon={CalendarClock}
            label="Obligations"
            value={o.obligations.within30}
            tone={o.obligations.within30 > 0 ? "warn" : "ok"}
            sub={
              o.obligations.next
                ? `next ${isoToShort(o.obligations.next.date)} · ${o.obligations.next.company}`
                : "due in 30 days"
            }
          />
          <Attention
            href="/import"
            icon={FolderOpen}
            label="Documents"
            value={o.docsMissing}
            tone={o.docsMissing > 0 ? "warn" : "ok"}
            sub="companies with no docs"
          />
        </div>
      </section>

      {/* 2 — Closing progress */}
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="text-base font-medium text-slate-800">Closing progress — {o.year}</h2>
          <span className="text-base font-semibold text-[#1f3a5f]">{o.closing.pct}%</span>
        </div>
        <div className="h-2.5 overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-[#1f3a5f]"
            style={{ width: `${o.closing.pct}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {o.closing.byCol.map((c) => {
            const full = c.total > 0 && c.ok === c.total;
            const none = c.ok === 0;
            const cls = full
              ? "bg-green-50 text-green-700"
              : none
                ? "bg-rose-50 text-rose-600"
                : "bg-amber-50 text-amber-700";
            return (
              <span key={c.key} className={`rounded-md px-2.5 py-0.5 text-xs ${cls}`}>
                {c.label} {c.ok}/{c.total}
              </span>
            );
          })}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 3 — Intercompany exposure */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-base font-medium text-slate-800">Intercompany exposure</h2>
            <Link href="/loans" className="text-xs text-[#1f3a5f] hover:underline">
              View loans →
            </Link>
          </div>
          <p className="mb-3 text-xs text-slate-400">{o.exposure.loans.length} loan(s) outstanding</p>
          {o.exposure.loans.length === 0 ? (
            <p className="text-sm text-slate-500">No intercompany loans yet.</p>
          ) : (
            <div className="space-y-2">
              {o.exposure.loans.slice(0, 5).map((l, i) => (
                <div key={i} className="flex items-center justify-between gap-3">
                  <div className="truncate text-sm text-slate-600">
                    {l.lender} <span className="text-slate-300">→</span> {l.borrower}
                  </div>
                  <div className="shrink-0 text-sm font-medium tabular-nums text-slate-800">
                    {formatMoney(l.principal, l.currency)}
                  </div>
                </div>
              ))}
              <div className="mt-1 flex flex-wrap justify-end gap-x-4 gap-y-1 border-t border-slate-100 pt-2">
                {o.exposure.totalsByCurrency.map((t) => (
                  <div key={t.currency} className="text-sm">
                    <span className="text-slate-400">Total {t.currency}: </span>
                    <span className="font-semibold tabular-nums text-[#1f3a5f]">
                      {formatMoney(t.principal, t.currency)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </section>

        {/* 4 — Company heatmap */}
        <section className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="mb-1 flex items-baseline justify-between">
            <h2 className="text-base font-medium text-slate-800">Companies — closing {o.year}</h2>
            <Link href="/closing" className="text-xs text-[#1f3a5f] hover:underline">
              Open closing →
            </Link>
          </div>
          <p className="mb-3 text-xs text-slate-400">
            {o.heatmap.length} companies · hover for name, click to open
          </p>
          <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-10">
            {o.heatmap.map((c) => {
              const cls =
                c.total === 0
                  ? "bg-slate-100"
                  : c.state === "complete"
                    ? "bg-green-400"
                    : c.state === "partial"
                      ? "bg-amber-300"
                      : "bg-rose-300";
              return (
                <Link
                  key={c.id}
                  href={`/companies/${c.id}/year/${o.year}`}
                  title={`${c.name} — ${c.total === 0 ? "N/A" : `${c.complete}/${c.total}`}`}
                  className={`aspect-square rounded ${cls} ring-1 ring-inset ring-black/5 transition hover:scale-110`}
                />
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-400">
            <Legend cls="bg-green-400" label="complete" />
            <Legend cls="bg-amber-300" label="partial" />
            <Legend cls="bg-rose-300" label="empty" />
            <Legend cls="bg-slate-100" label="N/A" />
          </div>
        </section>
      </div>
    </div>
  );
}

function Attention({
  href,
  icon: Icon,
  label,
  value,
  sub,
  tone,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string | number;
  sub: string;
  tone: "ok" | "warn" | "danger";
}) {
  const valueCls =
    tone === "danger" ? "text-rose-600" : tone === "warn" ? "text-amber-600" : "text-slate-800";
  return (
    <Link
      href={href}
      className="rounded-xl border border-slate-200 bg-white p-4 transition hover:border-[#1f3a5f]/40 hover:shadow-sm"
    >
      <div className="flex items-center gap-1.5 text-sm text-slate-500">
        <Icon className="h-4 w-4 text-slate-400" aria-hidden />
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold ${valueCls}`}>{value}</div>
      <div className="text-xs text-slate-400">{sub}</div>
    </Link>
  );
}

function Kpi({
  href,
  icon: Icon,
  label,
  value,
  sub,
  accent,
  tone = "ok",
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  value: string;
  sub: string;
  accent?: boolean;
  tone?: "ok" | "danger";
}) {
  return (
    <Link
      href={href}
      className={`rounded-xl border p-4 transition hover:shadow-sm ${accent ? "border-2 border-[#8DC63F]/60 bg-[#8DC63F]/[0.08] hover:border-[#8DC63F]" : "border-slate-200 bg-white hover:border-[#1f3a5f]/40"}`}
    >
      <div className="flex items-center gap-1.5 text-sm text-slate-500">
        <Icon className="h-4 w-4 text-slate-400" aria-hidden />
        {label}
      </div>
      <div className={`mt-1 text-2xl font-semibold tabular-nums ${accent ? "text-[#3B6D11]" : tone === "danger" ? "text-rose-600" : "text-slate-800"}`}>
        {value}
      </div>
      <div className="text-xs text-slate-400">{sub}</div>
    </Link>
  );
}

function Legend({ cls, label }: { cls: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={`inline-block h-2.5 w-2.5 rounded-sm ${cls}`} />
      {label}
    </span>
  );
}
