import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureScheduleBaseline, type BaselineHouse } from "@/lib/pools/schedule-baseline";
import { PoolTabsNav } from "@/components/pool-tabs";
import { PoolScheduleCsv } from "@/components/pool-schedule-csv";
import { PhaseGantt, ScheduleTable, type Phase, type RowData, type Span } from "@/components/pool-schedule-view";

export const dynamic = "force-dynamic";

// Cronograma previsto × realizado (mock aprovado 16/07; gantt refeito a pedido do Stefan:
// fases como BARRAS únicas início→fim, consolidado do pool no topo, data de mercado fecha
// a Venda). Previsto CONGELADO da simulação; tolerância "no prazo" ±7 dias.

const DAY_MS = 86400000;
const TOLERANCE = 7;

const fmt = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—";
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

// spans: previsto sempre fechado; realizado com início e sem fim = "em curso" (até hoje)
const prevSpan = (s: string | null, e: string | null): Span | null =>
  s ? { start: s, end: e ?? s } : null;
const realSpan = (s: string | null, e: string | null): Span | null =>
  s ? { start: s, end: e } : e ? { start: e, end: e } : null;

export default async function PoolSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const baseline = await ensureScheduleBaseline(id);
  const pool = await prisma.investmentPool.findUnique({
    where: { id },
    include: {
      houses: {
        include: { loanEntries: { where: { type: "DRAW", pending: false }, orderBy: { date: "asc" }, take: 1 } },
      },
      loans: {
        orderBy: { createdAt: "asc" },
        include: {
          bankProfile: { select: { name: true } },
          entries: { where: { pending: false }, select: { type: true, amount: true, date: true } },
        },
      },
      distributions: { orderBy: { date: "asc" } },
    },
  });
  if (!pool) notFound();

  const houseById = new Map(pool.houses.map((h) => [h.id, h]));
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

  const today = new Date().toISOString().slice(0, 10);

  const rows: RowData[] = (baseline?.houses ?? [])
    .map((b) => {
      const h = houseById.get(b.houseId);
      if (!h) return null;
      const cells = MILESTONES.map((m) => {
        const prev = (b[m.key] as string | null) ?? null;
        const real = realOf(h, m.key);
        return { key: m.key as string, label: m.label, prev, real, delta: deltaDays(prev, real) };
      });
      // fases como BARRAS início→fim (pedido do Stefan): venda fecha com a data de MERCADO
      const phases: Phase[] = [
        { label: "Lote", prev: prevSpan(b.emd, b.lotClose), real: realSpan(iso(h.lotContractDate) ?? iso(h.lotPaidDate), iso(h.lotPaidDate)) },
        { label: "Permit", prev: prevSpan(b.permitApp, b.permitIssued), real: realSpan(iso(h.permitAppliedDate), iso(h.permitIssuedDate)) },
        { label: "Obra", prev: prevSpan(b.buildStart, b.buildEnd), real: realSpan(iso(h.buildStartDate) ?? iso(h.loanEntries[0]?.date ?? null), iso(h.coDate)) },
        { label: "Venda", prev: prevSpan(b.buildEnd, b.sale), real: realSpan(iso(h.listedDate), iso(h.saleDate)) },
      ];
      return { houseId: b.houseId, addr: h.address.split(",")[0], sub: b.label, cells, phases };
    })
    .filter((r): r is NonNullable<typeof r> => r != null)
    .sort((a, b) => (a.cells[0].prev ?? "9999").localeCompare(b.cells[0].prev ?? "9999"));

  // ── consolidado do pool (igual ao gráfico de fases da simulação) ──
  const aggPhase = (label: string, idx: number): Phase => {
    const prevs = rows.map((r) => r.phases[idx].prev).filter((s): s is Span => s != null);
    const reals = rows.map((r) => r.phases[idx].real).filter((s): s is Span => s != null);
    const min = (xs: string[]) => (xs.length ? xs.reduce((a, b) => (a < b ? a : b)) : null);
    const max = (xs: string[]) => (xs.length ? xs.reduce((a, b) => (a > b ? a : b)) : null);
    const anyOpen = reals.some((s) => s.end == null);
    // fase agregada segue aberta se alguma casa está em curso OU se nem todas começaram
    const allDone = reals.length === rows.length && !anyOpen;
    return {
      label,
      prev: prevs.length ? { start: min(prevs.map((s) => s.start))!, end: max(prevs.map((s) => s.end ?? s.start)) } : null,
      real: reals.length
        ? { start: min(reals.map((s) => s.start))!, end: allDone ? max(reals.map((s) => s.end!)) : null }
        : null,
    };
  };
  const firstDist = iso(pool.distributions[0]?.date ?? null);
  const lastDist = iso(pool.distributions[pool.distributions.length - 1]?.date ?? null);

  // ── ciclo do LOAN (pedido do Stefan, 17/07): linha contínua em 2 partes por loan —
  // CONTRATAÇÃO (solicitação do LOI → closing; mede a celeridade do banco) e ATIVO
  // (closing → payoff final, saldo quitado). Previsto (da sim) plotado no 1º loan.
  const loanInfo = pool.loans.map((l, i) => {
    const bank = l.bankProfile?.name ?? "Banco a definir";
    const first = iso(l.firstContactDate);
    const closing = iso(l.closingDate);
    const balance = l.entries.reduce((s, e) => s + Number(e.amount), 0);
    const payoffs = l.entries.filter((e) => e.type === "PAYOFF").map((e) => iso(e.date)!).sort();
    const paidOff = l.entries.length > 0 && balance <= 0.01 && payoffs.length > 0;
    const payoffReal = paidOff ? payoffs[payoffs.length - 1] : null;
    const contractDays =
      first != null
        ? Math.round((new Date(closing ?? today).getTime() - new Date(first).getTime()) / DAY_MS)
        : null;
    return { bank, first, closing, payoffReal, active: l.entries.length > 0, contractDays, isFirst: i === 0 };
  });
  const loanPhases: Phase[] = baseline
    ? loanInfo.flatMap((l) => [
        {
          label: `${l.bank.split(" ")[0]} · contratação`,
          // motor não modela a solicitação — o previsto da contratação é o closing (marco)
          prev: l.isFirst ? prevSpan(baseline.pool.loanClosing, baseline.pool.loanClosing) : null,
          real: l.first ? { start: l.first, end: l.closing } : null,
        },
        {
          label: `${l.bank.split(" ")[0]} · ativo`,
          prev: l.isFirst ? prevSpan(baseline.pool.loanClosing, baseline.pool.loanPayoff ?? null) : null,
          real: l.closing ? { start: l.closing, end: l.payoffReal } : null,
        },
      ])
    : [];

  const consolidated: Phase[] = baseline
    ? [
        aggPhase("Lotes", 0),
        aggPhase("Permits", 1),
        aggPhase("Obra", 2),
        aggPhase("Vendas", 3),
        ...loanPhases,
        {
          label: "Distribuições",
          prev: prevSpan(baseline.pool.firstReturn, baseline.pool.lastReturn),
          real: firstDist ? { start: firstDist, end: pool.status === "CLOSED" ? lastDist : null } : null,
        },
      ]
    : [];

  // range global do gantt
  const allDates = [
    ...consolidated.flatMap((p) => [p.prev?.start, p.prev?.end, p.real?.start, p.real?.end]),
    baseline?.pool.loanClosing ?? null,
    today,
  ].filter((d): d is string => d != null);
  const range = {
    min: allDates.reduce((a, b) => (a < b ? a : b)),
    max: allDates.reduce((a, b) => (a > b ? a : b)),
    today,
  };

  // ── KPIs ──
  const done = rows.flatMap((r) => r.cells.filter((c) => c.delta != null));
  const deltas = done.map((c) => c.delta!).sort((x, y) => x - y);
  const avg = deltas.length ? Math.round(deltas.reduce((s, d) => s + d, 0) / deltas.length) : null;
  const median = deltas.length ? deltas[Math.floor(deltas.length / 2)] : null;
  const worst = deltas.length ? deltas[deltas.length - 1] : null;
  const onTime = done.filter((c) => Math.abs(c.delta!) <= TOLERANCE).length;
  const pendings = rows
    .flatMap((r) => r.cells.filter((c) => c.prev && !c.real).map((c) => ({ ...c, addr: r.addr })))
    .sort((a, b) => a.prev!.localeCompare(b.prev!));
  const next = pendings[0] ?? null;
  const byKey = new Map<string, { count: number; first: string }>();
  for (const p of pendings) {
    const cur = byKey.get(p.key);
    byKey.set(p.key, { count: (cur?.count ?? 0) + 1, first: cur?.first && cur.first < p.prev! ? cur.first : p.prev! });
  }
  const gargalo = [...byKey.entries()].sort((a, b) => a[1].first.localeCompare(b[1].first))[0] ?? null;
  const labelOf = (key: string) => MILESTONES.find((m) => m.key === key)?.label ?? key;

  const loanReal = pool.loans.find((l) => l.closingDate)?.closingDate ?? null;

  const csvRows = rows.flatMap((r) =>
    r.cells.map((c) => ({
      casa: r.addr,
      marco: c.label,
      previsto: c.prev ?? "",
      real: c.real ?? "",
      deltaDias: c.delta != null ? String(c.delta) : "",
    })),
  );

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
            ? `Previsto congelado da simulação "${baseline.simName}" (cenário ${baseline.scenarioCode}), ancorado no início ${fmt(baseline.startDate)}. Realizado: os fatos das fichas, draws, loan e distribuições.`
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
              <div className="text-xs text-slate-400">{next ? `prev. ${fmt(next.prev)} · ${next.addr}` : "tudo concluído"}</div>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4">
              <div className="text-xs text-slate-400">Gargalo atual</div>
              <div className="text-sm font-bold text-slate-900">{gargalo ? labelOf(gargalo[0]) : "—"}</div>
              <div className="text-xs text-slate-400">
                {gargalo ? `${gargalo[1].count}/${rows.length} pendentes · 1º prev. ${fmt(gargalo[1].first)}` : ""}
              </div>
            </div>
          </div>

          {/* consolidado do pool — igual ao gráfico de fases da simulação */}
          <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
              Fases do projeto — consolidado ({rows.length} casas)
            </h2>
            <div className="mt-3">
              <PhaseGantt phases={consolidated} range={range} height="lg" />
            </div>
            <div className="mt-2 space-y-0.5 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
              {loanInfo.map((l) => (
                <p key={l.bank}>
                  <b>{l.bank}</b>:{" "}
                  {l.first ? (
                    <>
                      LOI <b className="tabular-nums">{fmt(l.first)}</b> → closing{" "}
                      {l.closing ? (
                        <>
                          <b className="tabular-nums">{fmt(l.closing)}</b> —{" "}
                          <b className={l.contractDays! > 60 ? "text-amber-700" : "text-emerald-700"}>
                            contratado em {l.contractDays}d
                          </b>
                        </>
                      ) : (
                        <b className="text-amber-700">
                          pendente · {l.contractDays}d desde a solicitação —{" "}
                          <Link href={`/pools/${pool.id}/loan?stab=docs`} className="underline">
                            suba o contrato
                          </Link>
                        </b>
                      )}
                      {l.payoffReal && (
                        <>
                          {" "}· quitado em <b className="tabular-nums">{fmt(l.payoffReal)}</b>
                        </>
                      )}
                    </>
                  ) : (
                    <span className="text-amber-700">
                      solicitação do LOI sem data —{" "}
                      <Link href={`/pools/${pool.id}/loan?stab=terms`} className="underline">
                        registre nos Termos
                      </Link>{" "}
                      (a leitura do LOI preenche sozinha)
                    </span>
                  )}
                </p>
              ))}
              <p>
                Previsto na simulação: closing <b className="tabular-nums">{fmt(baseline.pool.loanClosing)}</b> · payoff
                final <b className="tabular-nums">{fmt(baseline.pool.loanPayoff ?? null)}</b> · Distribuições{" "}
                <b className="tabular-nums">{fmt(baseline.pool.firstReturn)}</b> →{" "}
                <b className="tabular-nums">{fmt(baseline.pool.lastReturn)}</b> · real{" "}
                <b className="tabular-nums">{firstDist ? `${fmt(firstDist)} → ${lastDist ? fmt(lastDist) : "…"}` : "—"}</b>
              </p>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Casas × fases</h2>
                <p className="mt-0.5 text-xs text-slate-400">
                  Realizado em cima, previsto embaixo; Δ verde adiantado / vermelho atrasado (±{TOLERANCE}d
                  no prazo). Clique na casa para a linha do tempo em barras.
                </p>
              </div>
              <PoolScheduleCsv rows={csvRows} />
            </div>
            <ScheduleTable rows={rows} milestones={MILESTONES.map((m) => ({ key: m.key, label: m.label }))} range={range} tolerance={TOLERANCE} />
            <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">
              O previsto está congelado — mexer na simulação não muda esta régua. O realizado entra
              sozinho pelos fatos (datas da ficha, 1º draw, CO, anúncio no mercado, venda, closing do
              loan via Documentos, distribuições).
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
