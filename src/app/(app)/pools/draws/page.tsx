import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

/**
 * DASH de draws (mock aprovado 17/07): só leitura + atalhos — a GESTÃO (solicitar,
 * creditar, ledger) mora na aba Draws de cada loan. KPIs agregados no topo; um card por
 * loan linkando direto para a aba; quitados esmaecidos no fim.
 */

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "blue" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === "blue" ? "text-blue-700" : "text-slate-900"}`}>{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export default async function DrawsDashboardPage() {
  const loans = await prisma.poolLoan.findMany({
    orderBy: [{ pool: { code: "asc" } }, { createdAt: "asc" }],
    include: {
      pool: { select: { id: true, code: true, alias: true, currency: true } },
      bankProfile: true,
      entries: {
        select: { amount: true, requestedAmount: true, requestDate: true, pending: true, type: true, date: true },
      },
      houses: { select: { bankLoanAmount: true } },
    },
  });

  const today = Date.now();
  const dayMs = 86_400_000;
  const year = new Date().getUTCFullYear();

  const cards = loans.map((loan) => {
    const p = loan.pool;
    const draws = loan.entries.filter((e) => e.type === "DRAW");
    const credited = draws.filter((e) => !e.pending).reduce((s, e) => s + Number(e.amount), 0);
    const awaiting = draws.filter((e) => e.pending).reduce((s, e) => s + Number(e.requestedAmount ?? 0), 0);
    const budget = loan.houses.reduce((s, h) => s + Number(h.bankLoanAmount ?? 0), 0);
    const available = budget - credited - awaiting;
    const pendingCount = draws.filter((e) => e.pending).length;
    const oldestPending = draws
      .filter((e) => e.pending && e.requestDate)
      .reduce<Date | null>((m, e) => (m == null || e.requestDate! < m ? e.requestDate! : m), null);
    const creditedYear = draws
      .filter((e) => !e.pending && e.date.getUTCFullYear() === year)
      .reduce((s, e) => s + Number(e.amount), 0);
    const real = loan.entries.filter((e) => !e.pending);
    const balance = real.reduce((s, e) => s + Number(e.amount), 0);
    const paidOff = real.some((e) => e.type === "PAYOFF") && balance <= 0.01;
    const awaitingClosing = !paidOff && loan.closingDate == null;
    return {
      loan,
      p,
      credited,
      awaiting,
      budget,
      available,
      pendingCount,
      oldestPending,
      creditedYear,
      paidOff,
      awaitingClosing,
      pct: budget > 0 ? Math.min(100, Math.round(((credited + awaiting) / budget) * 100)) : 0,
    };
  });

  const active = cards.filter((c) => !c.paidOff);
  const ordered = [...active, ...cards.filter((c) => c.paidOff)];
  const awaitingTotal = active.reduce((s, c) => s + c.awaiting, 0);
  const awaitingCount = active.reduce((s, c) => s + c.pendingCount, 0);
  const oldestDays = active
    .map((c) => c.oldestPending)
    .filter((d): d is Date => d != null)
    .map((d) => Math.round((today - d.getTime()) / dayMs))
    .reduce<number | null>((m, d) => (m == null || d > m ? d : m), null);
  const creditedYearTotal = cards.reduce((s, c) => s + c.creditedYear, 0);
  const availableTotal = active
    .filter((c) => !c.awaitingClosing)
    .reduce((s, c) => s + Math.max(0, c.available), 0);
  const cur = loans[0]?.pool.currency ?? "USD";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Draws</h1>
        <p className="text-sm text-slate-500">
          Visão geral dos construction loans — a gestão (solicitar, creditar, ledger) mora na
          aba <b>Draws</b> de cada loan; os cards levam direto para lá.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Kpi
          label="Aguardando banco (todos os loans)"
          value={formatMoney(awaitingTotal, cur)}
          hint={
            awaitingCount > 0
              ? `${awaitingCount} ${awaitingCount === 1 ? "draw" : "draws"}${oldestDays != null ? ` · mais antigo há ${oldestDays}d` : ""}`
              : "nenhum draw pendente"
          }
          tone={awaitingTotal > 0 ? "blue" : undefined}
        />
        <Kpi label={`Creditado no ano (${year})`} value={formatMoney(creditedYearTotal, cur)} hint="todos os loans" />
        <Kpi label="Disponível total" value={formatMoney(availableTotal, cur)} hint="loans ativos" />
      </div>

      {ordered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          Nenhum pool com construction loan ainda — configure os termos na aba Loan do pool.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((c) => (
            <Link
              key={c.loan.id}
              href={`/pools/${c.p.id}/loan?loan=${c.loan.id}&stab=draws`}
              className={`rounded-xl border border-slate-200 bg-white p-5 transition hover:border-[#1f3a5f]/40 hover:shadow-sm ${c.paidOff ? "opacity-55" : ""}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {c.p.code}
                  {c.p.alias ? ` · ${c.p.alias}` : ""}
                </span>
                {c.paidOff ? (
                  <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">Quitado</span>
                ) : c.awaitingClosing ? (
                  <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">aguardando closing</span>
                ) : c.pendingCount > 0 ? (
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">{c.pendingCount} aguardando</span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">em dia</span>
                )}
              </div>
              <div className="mt-1 truncate text-lg font-semibold text-slate-800">
                {c.loan.bankProfile?.name ?? "Banco a definir"}
                {c.loan.loanNumber ? ` · ${c.loan.loanNumber}` : ""}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div>
                  <div className="text-xs text-slate-400">Aprovado (casas)</div>
                  <div className="text-lg font-semibold tabular-nums text-slate-900">
                    {formatMoney(c.budget, c.p.currency)}
                  </div>
                  <div className="text-xs text-slate-400">creditado {formatMoney(c.credited, c.p.currency)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-400">Disponível</div>
                  <div className={`text-lg font-semibold tabular-nums ${c.available < 0 ? "text-red-600" : "text-slate-900"}`}>
                    {c.paidOff ? "encerrado" : c.awaitingClosing ? "— até o closing" : formatMoney(c.available, c.p.currency)}
                  </div>
                  {c.awaiting > 0 && (
                    <div className="text-xs text-blue-700">aguardando {formatMoney(c.awaiting, c.p.currency)}</div>
                  )}
                </div>
              </div>
              <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
                <div className="h-full rounded-full bg-[#1f3a5f]" style={{ width: `${c.paidOff ? 100 : c.pct}%` }} />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
