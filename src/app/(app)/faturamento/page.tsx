import { prisma } from "@/lib/db";
import { buildFaturamento, type Block, type PeriodFig } from "@/lib/reports/faturamento";

export const dynamic = "force-dynamic";

const MES_PT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${MES_PT[m - 1]}/${y}`;
};

export default async function FaturamentoPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string; month?: string }>;
}) {
  const { company: companyParam, month } = await searchParams;

  // Empresas que têm GL (a fonte do relatório).
  const withGl = await prisma.ledgerTxn.findMany({ distinct: ["companyId"], select: { companyId: true } });
  const ids = withGl.map((r) => r.companyId);
  const companies = await prisma.company.findMany({
    where: { id: { in: ids } },
    select: { id: true, legalName: true },
    orderBy: { legalName: "asc" },
  });

  const companyId = companyParam && ids.includes(companyParam) ? companyParam : companies[0]?.id;
  const data = companyId ? await buildFaturamento(companyId, month) : null;

  const fmt = (n: number, currency: string) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(n);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Revenue × Profit</h1>
        <p className="text-sm text-slate-500">
          Comparison of revenue, profit and margin by period, derived from the General Ledger. Pick
          the company and the reference month — the blocks compare against the previous month, the
          same month last year and the trailing 12-month window.
        </p>
      </div>

      {/* Seletores (form GET — sem JS) */}
      <form className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs font-medium text-slate-600">Company</span>
          <select name="company" defaultValue={companyId ?? ""} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
            {companies.map((c) => (
              <option key={c.id} value={c.id}>{c.legalName}</option>
            ))}
          </select>
        </label>
        {data && data.months.length > 0 && (
          <label className="text-sm">
            <span className="mb-1 block text-xs font-medium text-slate-600">Reference month</span>
            <select name="month" defaultValue={data.refMonth} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
              {data.months.map((m) => (
                <option key={m} value={m}>{monthLabel(m)}</option>
              ))}
            </select>
          </label>
        )}
        <button className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]">
          View
        </button>
      </form>

      {!data || data.months.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          {companies.length === 0
            ? "No company with an imported General Ledger yet."
            : "This company has no imported General Ledger — upload the GL in Documents to see revenue by month."}
        </div>
      ) : (
        <>
          {!data.canComputeNet && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-medium">Profit unavailable for this company.</span> There is a GL,
              but no P&L or Balance Sheet imported — and profit needs one of them to reliably separate
              expenses from balance-sheet accounts (assets, loans, intercompany). The{" "}
              <strong>revenue below already comes from the GL</strong>; import the P&L or the BS in
              Documents to unlock profit.
            </div>
          )}
          {data.canComputeNet && !data.coverage.hasPnl && (
            <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              <span className="font-medium">No P&L imported — revenue and profit may not match QBO.</span>{" "}
              Without the P&L, revenue is identified by the account name (Sales/Income), so revenue
              accounts with a different name (e.g. <strong>Services</strong>) or contra-revenue (e.g.{" "}
              <strong>Discounts given</strong>) are left out — and even count as an expense, reducing
              profit. <strong>Import the P&L</strong> (annual is fine) in Documents so the
              classification matches QBO.
            </div>
          )}
          <div className="grid gap-4 md:grid-cols-2">
            {data.blocks.map((b) => (
              <BlockCard key={b.key} b={b} currency={data.currency} fmt={fmt} />
            ))}
          </div>

          {/* Painel de conferência — para confiar nos números */}
          <details className="rounded-xl border border-slate-200 bg-white p-4 text-sm">
            <summary className="cursor-pointer font-medium text-slate-700">
              Data review ({Math.round(data.coverage.classifiedPct * 100)}% of activity classified)
            </summary>
            <div className="mt-3 space-y-2 text-slate-600">
              <p>
                <span className="text-slate-400">GL covers:</span> {monthLabel(data.coverage.glSpan.min ?? "")} —{" "}
                {monthLabel(data.coverage.glSpan.max ?? "")}.{" "}
                <span className="text-slate-400">Profit basis:</span>{" "}
                {data.coverage.netBasis === "nenhum" ? (
                  <span className="text-amber-700">none (import P&L or BS) — revenue only.</span>
                ) : (
                  <span>{data.coverage.netBasis}.</span>
                )}
              </p>
              {data.coverage.depreciationByYear.length > 0 && (
                <p>
                  <span className="text-slate-400">Depreciation spread (1/12 per month):</span>{" "}
                  {data.coverage.depreciationByYear.map((d) => `${d.year}: ${fmt(d.total, data.currency)}`).join(" · ")}.
                  Avoids the &ldquo;December drop&rdquo;; the yearly total doesn&apos;t change.
                </p>
              )}
              {data.coverage.missingMonths.length > 0 && (
                <p className="text-amber-700">
                  ⚠ Missing months in the GL for the full comparison: {data.coverage.missingMonths.map(monthLabel).join(", ")}.
                  The affected periods stay partial.
                </p>
              )}
              <p>
                <span className="text-slate-400">Revenue accounts used:</span>{" "}
                {data.coverage.incomeAccounts.length ? data.coverage.incomeAccounts.join(", ") : "—"}
              </p>
              {data.coverage.unknownAccounts.length > 0 && (
                <div>
                  <span className="text-slate-400">Accounts outside the P&L/BS (assumed to be expenses — check whether any is actually a balance-sheet or revenue account):</span>
                  <ul className="mt-1 space-y-0.5 text-xs">
                    {data.coverage.unknownAccounts.map((u) => (
                      <li key={u.account} className="tabular-nums">
                        {u.account} · {fmt(u.amount, data.currency)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-xs text-slate-400">
                Revenue comes from the revenue accounts (precise). Profit = revenue − classified
                expenses; check against the QBO P&L for the same period if there is any discrepancy.
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}

function pctText(v: number | null) {
  if (v == null) return "—";
  const s = (v * 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `${v > 0 ? "+" : ""}${s}%`;
}
function pctColor(v: number | null) {
  if (v == null) return "text-slate-400";
  return v >= 0 ? "text-emerald-600" : "text-red-600";
}

function BlockCard({
  b,
  currency,
  fmt,
}: {
  b: Block;
  currency: string;
  fmt: (n: number, c: string) => string;
}) {
  const cell = (f: PeriodFig | null) =>
    f ? (
      <div className="text-right">
        <div className="font-semibold tabular-nums text-slate-800">{fmt(f.income, currency)}</div>
        <div className="text-xs tabular-nums text-slate-500">
          {f.net == null
            ? "Profit —"
            : `Profit ${fmt(f.net, currency)} · ${f.margin == null ? "—" : `${(f.margin * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`}`}
        </div>
      </div>
    ) : (
      <div className="text-right text-slate-300">—</div>
    );

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-3 text-sm font-medium text-slate-700">{b.title}</div>
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">{b.current.label}</span>
          {cell(b.current)}
        </div>
        {b.compare && (
          <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-2">
            <span className="text-xs text-slate-500">{b.compare.label}</span>
            {cell(b.compare)}
          </div>
        )}
      </div>
      {b.compare && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-slate-100 pt-3 text-xs">
          <span>
            <span className="text-slate-400">Revenue:</span>{" "}
            <span className={`font-medium ${pctColor(b.revVar)}`}>{pctText(b.revVar)}</span>
          </span>
          <span>
            <span className="text-slate-400">Profit:</span>{" "}
            <span className={`font-medium ${pctColor(b.profitVar)}`}>{pctText(b.profitVar)}</span>
          </span>
        </div>
      )}
    </div>
  );
}
