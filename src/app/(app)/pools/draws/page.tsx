import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

// Dash de construction loans: um card por loan; clique abre as abas Casas (disponibilidade
// + solicitar draw) e Ledger de draws.
export default async function DrawsDashboardPage() {
  const pools = await prisma.investmentPool.findMany({
    where: { loan: { isNot: null } },
    orderBy: { code: "asc" },
    include: {
      loan: {
        include: {
          bankProfile: true,
          entries: { select: { amount: true, requestedAmount: true, pending: true, type: true, date: true } },
        },
      },
      houses: { select: { bankLoanAmount: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Draws</h1>
        <p className="text-sm text-slate-500">
          Um card por construction loan — clique para ver a disponibilidade por casa e o ledger
          de draws.
        </p>
      </div>

      {pools.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          Nenhum pool com construction loan ainda — configure os termos na aba Loan statement do
          pool.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pools.map((p) => {
            const loan = p.loan!;
            const draws = loan.entries.filter((e) => e.type === "DRAW");
            const credited = draws
              .filter((e) => !e.pending)
              .reduce((s, e) => s + Number(e.amount), 0);
            const awaiting = draws
              .filter((e) => e.pending)
              .reduce((s, e) => s + Number(e.requestedAmount ?? 0), 0);
            const budget = p.houses.reduce((s, h) => s + Number(h.bankLoanAmount ?? 0), 0);
            const available = budget - credited - awaiting;
            const pendingCount = draws.filter((e) => e.pending).length;
            // quitado: saldo total do loan ≤ 0 com payoffs; data = último lançamento
            const real = loan.entries.filter((e) => !e.pending);
            const balance = real.reduce((s, e) => s + Number(e.amount), 0);
            const paidOff = real.some((e) => e.type === "PAYOFF") && balance <= 0.01;
            const quitDate = paidOff
              ? real.reduce((m, e) => (e.date > m ? e.date : m), real[0].date)
              : null;
            return (
              <Link
                key={p.id}
                href={`/pools/draws/${p.id}`}
                className="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-[#1f3a5f]/40 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {p.code}
                    {p.alias ? ` · ${p.alias}` : ""}
                  </span>
                  {paidOff ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700">
                      Quitado em {quitDate!.toISOString().slice(0, 10)}
                    </span>
                  ) : pendingCount > 0 ? (
                    <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-700">
                      {pendingCount} aguardando
                    </span>
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      em dia
                    </span>
                  )}
                </div>
                <div className="mt-1 truncate text-lg font-semibold text-slate-800">
                  {loan.bankProfile?.name ?? "Banco a definir"}
                  {loan.loanNumber ? ` · ${loan.loanNumber}` : ""}
                </div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-400">Aprovado (casas)</div>
                    <div className="text-lg font-semibold tabular-nums text-slate-900">
                      {formatMoney(budget, "USD")}
                    </div>
                    <div className="text-xs text-slate-400">
                      creditado {formatMoney(credited, "USD")}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Disponível</div>
                    <div
                      className={`text-lg font-semibold tabular-nums ${available < 0 ? "text-red-600" : "text-slate-900"}`}
                    >
                      {formatMoney(available, "USD")}
                    </div>
                    {awaiting > 0 && (
                      <div className="text-xs text-blue-700">
                        aguardando {formatMoney(awaiting, "USD")}
                      </div>
                    )}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
