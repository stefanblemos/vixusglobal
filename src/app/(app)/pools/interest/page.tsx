import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { computeLoanInterest } from "@/lib/pools/loan-interest";

export const dynamic = "force-dynamic";

/**
 * Menu JUROS (mock aprovado 17/07): todos os loans de todos os pools — previsão, pago,
 * devido e próximo vencimento. Loans QUITADOS ficam ocultos (toggle "mostrar quitados");
 * "aguardando closing" aparecem zerados (sem juros até o closing).
 */

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400";
const tdRight = "px-3 py-2 text-right text-sm tabular-nums text-slate-700";

function Card({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "amber" }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${tone === "amber" ? "text-amber-700" : "text-slate-900"}`}>{value}</div>
      {hint && <div className="text-xs text-slate-400">{hint}</div>}
    </div>
  );
}

export default async function PoolsInterestPage({
  searchParams,
}: {
  searchParams: Promise<{ all?: string }>;
}) {
  const { all } = await searchParams;
  const showPaidOff = all === "1";
  const pools = await prisma.investmentPool.findMany({
    orderBy: { code: "asc" },
    include: {
      loans: {
        orderBy: { createdAt: "asc" },
        include: {
          bankProfile: true,
          entries: { where: { pending: false }, select: { type: true, date: true, amount: true } },
        },
      },
    },
  });

  const today = new Date();
  const dayMs = 86_400_000;
  const fmtBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

  const rows = pools.flatMap((pool) =>
    pool.loans.map((l) => {
      const bank = l.bankProfile;
      const entries = l.entries.map((e) => ({ type: e.type as string, date: e.date, amount: Number(e.amount) }));
      const balance = entries.reduce((s, e) => s + e.amount, 0);
      const paidOff = entries.some((e) => e.type === "PAYOFF") && balance <= 0.01 && entries.length > 0;
      const apr =
        l.aprPct != null
          ? Number(l.aprPct)
          : bank
            ? bank.rateType === "FIXED"
              ? Number(bank.aprPct)
              : Number(bank.indexPct) + Number(bank.spreadPct)
            : null;
      const view = l.closingDate
        ? computeLoanInterest({
            entries,
            aprPct: apr,
            closingDate: l.closingDate,
            dueDay: l.interestDueDay,
            graceDays: l.graceDays,
            today,
          })
        : null;
      const status: "quitado" | "ativo" | "aguardando" = paidOff ? "quitado" : l.closingDate ? "ativo" : "aguardando";
      return {
        poolId: pool.id,
        poolCode: pool.code,
        currency: pool.currency,
        loanId: l.id,
        label: `${bank?.name ?? "Banco a definir"}${l.loanNumber ? ` · ${l.loanNumber}` : ""}`,
        aprText: apr != null ? `${apr}%` : "—",
        reserveText: bank ? (bank.hasInterestReserve ? "reserve financiada" : "sem reserve") : "",
        status,
        view,
      };
    }),
  );

  const active = rows.filter((r) => r.status !== "quitado");
  const paidOffRows = rows.filter((r) => r.status === "quitado");
  const visible = showPaidOff ? [...active, ...paidOffRows] : active;

  const dueNow = active.reduce((s, r) => s + (r.view?.dueNow ?? 0), 0);
  const dueCount = active.filter((r) => (r.view?.dueNow ?? 0) > 0).length;
  const next30 = active.reduce((s, r) => {
    if (!r.view) return s;
    const upcoming = r.view.periods
      .filter((p) => (p.status === "devido" || p.status === "vencido" || p.status === "corrente") && p.owed > 0)
      .filter((p) => new Date(p.dueDate).getTime() - today.getTime() <= 30 * dayMs)
      .reduce((x, p) => x + p.owed, 0);
    return s + Math.max(upcoming, r.view.dueNow);
  }, 0);
  const year = today.getUTCFullYear();
  const paidYearReal = pools
    .flatMap((p) => p.loans)
    .filter((l) => {
      const bal = l.entries.reduce((s, e) => s + Number(e.amount), 0);
      const off = l.entries.some((e) => e.type === "PAYOFF") && bal <= 0.01 && l.entries.length > 0;
      return !off;
    })
    .flatMap((l) => l.entries)
    .filter((e) => e.type === "INTEREST_PAYMENT" && e.date.getUTCFullYear() === year)
    .reduce((s, e) => s + Math.abs(Number(e.amount)), 0);
  const cur = pools[0]?.currency ?? "USD";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Juros dos financiamentos</h1>
        <p className="text-sm text-slate-500">
          Todos os loans, todos os pools — previsão, pago e devido. Quitados ficam ocultos;
          &quot;aguardando closing&quot; ainda não geram juros. O detalhe período a período está
          no statement de cada loan.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Card
          label="Devido agora"
          value={formatMoney(dueNow, cur)}
          hint={dueCount > 0 ? `${dueCount} ${dueCount === 1 ? "loan com vencimento" : "loans com vencimento"}` : "nada vencido"}
          tone={dueNow > 0 ? "amber" : undefined}
        />
        <Card label="Previsto próximos 30 dias" value={formatMoney(next30, cur)} hint="devido + período corrente" />
        <Card label={`Pago no ano (${year})`} value={formatMoney(paidYearReal, cur)} hint="loans ativos" />
      </div>

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Loan · pool</th>
                <th className={th}>Status</th>
                <th className={thRight}>Saldo base</th>
                <th className={thRight}>Juros/mês</th>
                <th className={thRight}>Pago acum.</th>
                <th className={thRight}>Devido</th>
                <th className={th}>Próx. vencimento</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-sm text-slate-400">
                    Nenhum loan ainda.
                  </td>
                </tr>
              )}
              {visible.map((r) => {
                const dDays = r.view?.nextDue
                  ? Math.ceil((new Date(r.view.nextDue.date).getTime() - today.getTime()) / dayMs)
                  : null;
                return (
                  <tr key={r.loanId} className="border-b border-slate-50">
                    <td className="px-3 py-2.5">
                      <Link
                        href={`/pools/${r.poolId}/loan?loan=${r.loanId}`}
                        className="text-sm font-bold text-[#1f3a5f] hover:underline"
                      >
                        {r.label}
                      </Link>
                      <div className="text-[10.5px] text-slate-400">
                        {r.poolCode} · {r.aprText}
                        {r.reserveText ? ` · ${r.reserveText}` : ""}
                      </div>
                    </td>
                    <td className="px-3 py-2.5">
                      {r.status === "ativo" ? (
                        <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">ativo</span>
                      ) : r.status === "aguardando" ? (
                        <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] text-amber-700">aguardando closing</span>
                      ) : (
                        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] text-slate-500">quitado</span>
                      )}
                    </td>
                    <td className={tdRight}>{r.view && r.view.balance > 0 ? formatMoney(r.view.balance, r.currency) : "—"}</td>
                    <td className={tdRight}>{r.view?.monthlyEst != null ? formatMoney(r.view.monthlyEst, r.currency) : "—"}</td>
                    <td className={tdRight}>{r.view && r.view.paidTotal > 0 ? formatMoney(r.view.paidTotal, r.currency) : "—"}</td>
                    <td className={`${tdRight} ${r.view && r.view.dueNow > 0 ? "font-bold text-amber-700" : ""}`}>
                      {r.view && r.view.dueNow > 0 ? formatMoney(r.view.dueNow, r.currency) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-sm text-slate-600">
                      {r.status === "aguardando" ? (
                        <span className="text-xs text-slate-400">sem juros até o closing</span>
                      ) : r.status === "quitado" ? (
                        <span className="text-xs text-slate-400">—</span>
                      ) : r.view?.nextDue ? (
                        <>
                          <b className="tabular-nums">{fmtBr(r.view.nextDue.date)}</b>
                          {dDays != null && (
                            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${dDays < 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                              {dDays < 0 ? `+${-dDays}d` : `D-${dDays}`}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="border-t border-slate-100 px-5 py-3 text-[11.5px] text-slate-500">
          {paidOffRows.length > 0 && (
            <>
              ☑ {paidOffRows.length} {paidOffRows.length === 1 ? "loan quitado" : "loans quitados"}{" "}
              {showPaidOff ? "exibidos" : "ocultos"} —{" "}
              {paidOffRows.map((r) => `${r.label} (${r.poolCode})`).join(" · ")}.{" "}
              <Link href={showPaidOff ? "/pools/interest" : "/pools/interest?all=1"} className="font-semibold text-[#1f3a5f] hover:underline">
                {showPaidOff ? "ocultar quitados" : "mostrar quitados"}
              </Link>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
