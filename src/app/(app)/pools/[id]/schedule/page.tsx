import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureScheduleBaseline, type BaselineHouse } from "@/lib/pools/schedule-baseline";
import { PoolTabsNav } from "@/components/pool-tabs";
import { PoolScheduleCsv } from "@/components/pool-schedule-csv";

export const dynamic = "force-dynamic";

// Cronograma previsto × realizado (mock aprovado 16/07) — o miolo do report mensal.
// Previsto: baseline CONGELADO da simulação apresentada. Realizado: os fatos das fichas,
// draws, loan e distribuições. Tolerância "no prazo": ±7 dias (decisão do Stefan).

const DAY_MS = 86400000;
const TOLERANCE = 7;

const fmt = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : null;
const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const deltaDays = (prev: string | null, real: string | null) =>
  prev && real ? Math.round((new Date(real).getTime() - new Date(prev).getTime()) / DAY_MS) : null;

const MILESTONES: Array<{ key: keyof BaselineHouse & string; label: string }> = [
  { key: "lotClose", label: "Lote (closing)" },
  { key: "permitApp", label: "Permit aplicado" },
  { key: "permitIssued", label: "Permit emitido" },
  { key: "buildStart", label: "Início obra" },
  { key: "buildEnd", label: "Obra 100% / CO" },
  { key: "sale", label: "Venda (closing)" },
];

function DeltaBadge({ d }: { d: number | null }) {
  if (d == null) return null;
  if (Math.abs(d) <= TOLERANCE)
    return <div className="text-[10.5px] font-bold text-emerald-700">{d === 0 ? "no dia" : `${d > 0 ? "+" : "−"}${Math.abs(d)}d`} ✓</div>;
  return d < 0 ? (
    <div className="text-[10.5px] font-bold text-emerald-700">−{Math.abs(d)}d ✓</div>
  ) : (
    <div className="text-[10.5px] font-bold text-red-700">+{d}d ⚠</div>
  );
}

export default async function PoolSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const baseline = await ensureScheduleBaseline(id);
  const pool = await prisma.investmentPool.findUnique({
    where: { id },
    include: {
      houses: {
        include: { loanEntries: { where: { type: "DRAW", pending: false }, orderBy: { date: "asc" }, take: 1 } },
      },
      loans: { orderBy: { createdAt: "asc" }, include: { bankProfile: { select: { name: true } } } },
      distributions: { orderBy: { date: "asc" } },
    },
  });
  if (!pool) notFound();

  const houseById = new Map(pool.houses.map((h) => [h.id, h]));
  // realizado por marco — os mesmos fatos que movem as fases (zero digitação extra)
  const realOf = (h: (typeof pool.houses)[number], key: string): string | null => {
    switch (key) {
      case "emd":
        return iso(h.lotContractDate);
      case "lotClose":
        return iso(h.lotPaidDate);
      case "permitApp":
        return iso(h.permitAppliedDate);
      case "permitIssued":
        return iso(h.permitIssuedDate);
      case "buildStart":
        return iso(h.buildStartDate) ?? iso(h.loanEntries[0]?.date ?? null);
      case "buildEnd":
        return iso(h.coDate);
      case "sale":
        return iso(h.saleDate);
      default:
        return null;
    }
  };

  const rows = (baseline?.houses ?? [])
    .map((b) => {
      const h = houseById.get(b.houseId);
      if (!h) return null;
      return {
        b,
        h,
        cells: MILESTONES.map((m) => {
          const prev = (b[m.key] as string | null) ?? null;
          const real = realOf(h, m.key);
          return { key: m.key, prev, real, delta: deltaDays(prev, real) };
        }),
      };
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .sort((a, b) => (a.cells[0].prev ?? "9999").localeCompare(b.cells[0].prev ?? "9999"));

  // ── KPIs ──
  const done = rows.flatMap((r) => r.cells.filter((c) => c.delta != null));
  const deltas = done.map((c) => c.delta!) .sort((x, y) => x - y);
  const avg = deltas.length ? Math.round(deltas.reduce((s, d) => s + d, 0) / deltas.length) : null;
  const median = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
  const worst = deltas.length ? deltas[deltas.length - 1] : null;
  const onTime = done.filter((c) => Math.abs(c.delta!) <= TOLERANCE).length;

  // próximo marco: menor previsto ainda sem realizado
  const pendings = rows
    .flatMap((r) => r.cells.filter((c) => c.prev && !c.real).map((c) => ({ ...c, addr: r.h.address })))
    .sort((a, b) => a.prev!.localeCompare(b.prev!));
  const next = pendings[0] ?? null;
  // gargalo: o marco (coluna) com mais casas pendentes cujo previsto mais cedo já bate
  const byKey = new Map<string, { count: number; first: string }>();
  for (const p of pendings) {
    const cur = byKey.get(p.key);
    byKey.set(p.key, { count: (cur?.count ?? 0) + 1, first: cur?.first && cur.first < p.prev! ? cur.first : p.prev! });
  }
  const gargalo = [...byKey.entries()].sort((a, b) => a[1].first.localeCompare(b[1].first))[0] ?? null;
  const labelOf = (key: string) => MILESTONES.find((m) => m.key === key)?.label ?? key;

  // marcos do pool: closing do(s) loan(s) e distribuições
  const loanReal = pool.loans.find((l) => l.closingDate)?.closingDate ?? null;
  const firstDist = pool.distributions[0]?.date ?? null;
  const lastDist = pool.distributions[pool.distributions.length - 1]?.date ?? null;

  // gantt: range global (min..max de todas as datas)
  const allDates = [
    ...rows.flatMap((r) => r.cells.flatMap((c) => [c.prev, c.real])),
    baseline?.pool.loanClosing ?? null,
    baseline?.pool.lastReturn ?? null,
  ].filter((d): d is string => d != null);
  const minT = allDates.length ? new Date(allDates.reduce((a, b) => (a < b ? a : b))).getTime() : 0;
  const maxT = allDates.length ? new Date(allDates.reduce((a, b) => (a > b ? a : b))).getTime() : 1;
  const pos = (isoDate: string) => Math.max(0, Math.min(100, ((new Date(isoDate).getTime() - minT) / Math.max(1, maxT - minT)) * 100));

  const csvRows = rows.flatMap((r) =>
    r.cells.map((c) => ({
      casa: r.h.address,
      marco: labelOf(c.key),
      previsto: c.prev ?? "",
      real: c.real ?? "",
      deltaDias: c.delta != null ? String(c.delta) : "",
    })),
  );

  const th = "px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-slate-400";

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/pools/${pool.id}`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {pool.code}
          {pool.alias ? ` · ${pool.alias}` : ""}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Cronograma — previsto × realizado</h1>
        <p className="text-sm text-slate-500">
          {baseline
            ? `Previsto congelado da simulação "${baseline.simName}" (cenário ${baseline.scenarioCode}) em ${fmt(baseline.frozenAt.slice(0, 10))}, ancorado no início ${fmt(baseline.startDate)}. Realizado: os fatos das fichas, draws, loan e distribuições.`
            : "Sem baseline ainda — defina o Início do pool (Edit pool) com uma simulação vinculada e volte aqui: o previsto congela no primeiro acesso."}
        </p>
      </div>

      <PoolTabsNav poolId={pool.id} active="schedule" />

      {baseline && rows.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-400">Atraso médio (marcos concluídos)</div>
              <div className={`text-xl font-bold tabular-nums ${avg != null && avg > TOLERANCE ? "text-amber-700" : "text-slate-900"}`}>
                {avg != null ? `${avg > 0 ? "+" : ""}${avg} dias` : "—"}
              </div>
              <div className="text-xs text-slate-400">
                {median != null ? `mediana ${median > 0 ? "+" : ""}${median}d · pior ${worst! > 0 ? "+" : ""}${worst}d` : "nenhum marco concluído"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-400">Marcos no prazo</div>
              <div className="text-xl font-bold tabular-nums text-slate-900">
                {done.length > 0 ? `${onTime}/${done.length}` : "—"}
              </div>
              <div className="text-xs text-slate-400">±{TOLERANCE} dias de tolerância</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-400">Próximo marco previsto</div>
              <div className="text-sm font-bold text-slate-900">{next ? labelOf(next.key) : "—"}</div>
              <div className="text-xs text-slate-400">
                {next ? `prev. ${fmt(next.prev)} · ${next.addr.split(",")[0]}` : "tudo concluído"}
              </div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-400">Gargalo atual</div>
              <div className="text-sm font-bold text-slate-900">{gargalo ? labelOf(gargalo[0]) : "—"}</div>
              <div className="text-xs text-slate-400">
                {gargalo ? `${gargalo[1].count}/${rows.length} pendentes · 1º prev. ${fmt(gargalo[1].first)}` : ""}
              </div>
            </div>
          </div>

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
                  Casas × fases
                </h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Realizado em cima, previsto embaixo; Δ verde adiantado / vermelho atrasado (±
                  {TOLERANCE}d no prazo). Expanda a casa para a linha do tempo.
                </p>
              </div>
              <PoolScheduleCsv rows={csvRows} />
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={`${th} text-left`} style={{ width: "20%" }}>Casa</th>
                    {MILESTONES.map((m) => (
                      <th key={m.key} className={th}>
                        {m.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.b.houseId} className="border-b border-slate-50 align-top">
                      <td className="px-3 py-2">
                        <details>
                          <summary className="cursor-pointer list-none">
                            <div className="text-xs font-bold text-[#1f3a5f] hover:underline">
                              {r.h.address.split(",")[0]}
                            </div>
                            <div className="text-[10px] text-slate-400">{r.b.label}</div>
                          </summary>
                          {/* gantt da casa: previsto (cinza) × realizado (navy) no range do projeto */}
                          <div className="mt-2 w-56 space-y-1">
                            {r.cells.map((c) => (
                              <div key={c.key} className="flex items-center gap-1.5">
                                <span className="w-16 text-[9px] text-slate-400">{labelOf(c.key)}</span>
                                <div className="relative h-2.5 flex-1 rounded bg-slate-50">
                                  {c.prev && (
                                    <div
                                      className="absolute top-0 h-1 rounded bg-slate-300"
                                      style={{ left: `${pos(c.prev)}%`, width: "3%", minWidth: 5 }}
                                    />
                                  )}
                                  {c.real && (
                                    <div
                                      className="absolute bottom-0 h-1 rounded bg-[#1f3a5f]"
                                      style={{ left: `${pos(c.real)}%`, width: "3%", minWidth: 5 }}
                                    />
                                  )}
                                </div>
                              </div>
                            ))}
                            <div className="text-[9px] text-slate-400">▪ cinza = previsto · ▪ navy = realizado</div>
                          </div>
                        </details>
                      </td>
                      {r.cells.map((c) => (
                        <td key={c.key} className="px-2 py-2 text-center">
                          {c.real ? (
                            <>
                              <div className="text-xs font-bold tabular-nums text-slate-800">{fmt(c.real)}</div>
                              {c.prev && <div className="text-[10px] tabular-nums text-slate-400">prev {fmt(c.prev)}</div>}
                              <DeltaBadge d={c.delta} />
                            </>
                          ) : c.prev ? (
                            <>
                              <div className="text-xs tabular-nums text-slate-400">prev {fmt(c.prev)}</div>
                              {new Date(c.prev) < new Date() ? (
                                <div className="text-[10px] font-semibold text-amber-700">registrar</div>
                              ) : (
                                <div className="text-[10px] text-slate-300">futuro</div>
                              )}
                            </>
                          ) : (
                            <div className="text-xs text-slate-300">—</div>
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                  {/* marcos do POOL: loan e distribuições (do conjunto, não de uma casa) */}
                  <tr className="bg-slate-50/70">
                    <td className="px-3 py-2 text-xs font-bold text-slate-700">
                      Marcos do POOL
                      <div className="text-[10px] font-normal text-slate-400">loan · distribuições</div>
                    </td>
                    <td colSpan={2} className="px-2 py-2 text-center text-[11px]">
                      <span className="text-slate-500">Closing do loan{pool.loans.length > 1 ? "s" : ""} — </span>
                      prev <b className="tabular-nums">{fmt(baseline.pool.loanClosing) ?? "—"}</b> · real{" "}
                      {loanReal ? (
                        <b className="tabular-nums">{fmt(iso(loanReal))}</b>
                      ) : (
                        <Link href={`/pools/${pool.id}/loan?stab=docs`} className="font-semibold text-amber-700 underline">
                          suba o contrato
                        </Link>
                      )}
                    </td>
                    <td colSpan={2} className="px-2 py-2 text-center text-[11px]">
                      <span className="text-slate-500">1ª distribuição — </span>
                      prev <b className="tabular-nums">{fmt(baseline.pool.firstReturn) ?? "—"}</b> · real{" "}
                      <b className="tabular-nums">{firstDist ? fmt(iso(firstDist)) : "—"}</b>
                    </td>
                    <td colSpan={2} className="px-2 py-2 text-center text-[11px]">
                      <span className="text-slate-500">Distribuição final — </span>
                      prev <b className="tabular-nums">{fmt(baseline.pool.lastReturn) ?? "—"}</b> · real{" "}
                      <b className="tabular-nums">{lastDist ? fmt(iso(lastDist)) : "—"}</b>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">
              O previsto está congelado — mexer na simulação não muda esta régua. O realizado entra
              sozinho pelos fatos que você já lança (datas da ficha, 1º draw, CO, venda, closing do
              loan via Documentos, distribuições). Única digitação nova: as duas datas de permit na
              Linha do tempo da ficha.
            </p>
          </section>
        </>
      )}

      {baseline && rows.length === 0 && (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
          Baseline congelado, mas nenhuma casa casou com as unidades da simulação — confira
          modelo/localização das casas.
        </p>
      )}
    </div>
  );
}
