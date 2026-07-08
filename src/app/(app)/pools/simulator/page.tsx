import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

type Kpis = { totalInvested?: number; irrAnnual?: number | null; profit?: number; durationDays?: number };

export default async function SimulatorListPage() {
  const sims = await prisma.poolSimulation.findMany({
    orderBy: { createdAt: "desc" },
    include: { scenario: true, bankProfile: true, pool: true },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Investment simulator</h1>
          <p className="text-sm text-slate-500">
            Simulate the thesis (houses, funding, scenario) and generate the ledger to send to
            investors before the project. Assumptions live in the{" "}
            <Link href="/pools/catalog" className="text-[#1f3a5f] hover:underline">
              catalog
            </Link>
            .
          </p>
        </div>
        <Link
          href="/pools/simulator/new"
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
        >
          + New simulation
        </Link>
      </div>

      {sims.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          No simulations yet.
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sims.map((s) => {
            const k = ((s.result as { kpis?: Kpis } | null)?.kpis ?? {}) as Kpis;
            return (
              <Link
                key={s.id}
                href={`/pools/simulator/${s.id}`}
                className="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-[#1f3a5f]/40 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {s.scenario.name} · {s.fundingMode === "BANK" ? s.bankProfile?.name ?? "Bank" : "Equity"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {(s.units as unknown[]).length} houses
                  </span>
                </div>
                <div className="mt-1 truncate text-lg font-semibold text-slate-800">{s.name}</div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-400">Investor IRR</div>
                    <div className="text-lg font-semibold tabular-nums text-slate-900">
                      {k.irrAnnual != null ? `${(k.irrAnnual * 100).toFixed(1)}%` : "—"}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Peak capital</div>
                    <div className="text-lg font-semibold tabular-nums text-slate-900">
                      {k.totalInvested != null ? formatMoney(k.totalInvested, "USD") : "—"}
                    </div>
                  </div>
                </div>
                {s.pool && <div className="mt-2 text-xs text-slate-400">pool: {s.pool.code}</div>}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
