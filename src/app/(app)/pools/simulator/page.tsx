import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

type Kpis = { totalInvested?: number; irrAnnual?: number | null; profit?: number; durationDays?: number };

// Lista do simulador (regra do Stefan, 15/07): por padrão só as simulações EM TRABALHO —
// convertida em pool sai da vista; o filtro "mostrar convertidas" traz as fechadas de volta
// (com selo e link para o pool).
export default async function SimulatorListPage({
  searchParams,
}: {
  searchParams: Promise<{ convertidas?: string }>;
}) {
  const showConverted = (await searchParams).convertidas === "1";
  const [sims, convertedCount] = await Promise.all([
    prisma.poolSimulation.findMany({
      where: showConverted ? {} : { poolId: null },
      orderBy: { createdAt: "desc" },
      include: { scenario: true, bankProfile: true, pool: true },
    }),
    prisma.poolSimulation.count({ where: { poolId: { not: null } } }),
  ]);

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
        <div className="flex items-center gap-3">
          {convertedCount > 0 && (
            <Link
              href={showConverted ? "/pools/simulator" : "/pools/simulator?convertidas=1"}
              className={`rounded-lg border px-3 py-2 text-sm transition ${
                showConverted
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "border-slate-300 text-slate-600 hover:bg-slate-100"
              }`}
              title="Convertidas em pool saem da lista por padrão — marque para vê-las"
            >
              {showConverted ? "✓ " : ""}Mostrar convertidas ({convertedCount})
            </Link>
          )}
          <Link
            href="/pools/simulator/new"
            className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
          >
            + New simulation
          </Link>
        </div>
      </div>

      {sims.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          {convertedCount > 0
            ? "Nenhuma simulação em trabalho — as convertidas estão no filtro acima."
            : "No simulations yet."}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sims.map((s) => {
            const k = ((s.result as { kpis?: Kpis } | null)?.kpis ?? {}) as Kpis;
            const converted = !!s.pool;
            return (
              <Link
                key={s.id}
                href={`/pools/simulator/${s.id}`}
                className={`rounded-xl border bg-white p-5 transition hover:shadow-sm ${
                  converted
                    ? "border-emerald-200 hover:border-emerald-400"
                    : "border-slate-200 hover:border-[#1f3a5f]/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {s.scenario.name} · {s.fundingMode === "BANK" ? s.bankProfile?.name ?? "Bank" : "Equity"}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {(s.units as unknown[]).length} houses
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="truncate text-lg font-semibold text-slate-800">{s.name}</span>
                  {converted && (
                    <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                      Convertida · {s.pool!.code}
                    </span>
                  )}
                </div>
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
                {converted && (
                  <div className="mt-2 text-xs text-emerald-600">
                    virou o pool {s.pool!.code} — abrir para ver o vínculo
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
