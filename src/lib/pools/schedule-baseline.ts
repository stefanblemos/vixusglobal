import { prisma } from "@/lib/db";

/**
 * Cronograma PREVISTO congelado (mock aprovado 16/07): snapshot dos marcos por casa
 * extraídos da simulação APRESENTADA aos sócios, ancorados no início do pool. Congela
 * uma vez (na conversão, ou no primeiro acesso p/ pools antigos) e nunca recalcula —
 * os deltas do report mensal não mudam retroativamente.
 */

export type BaselineHouse = {
  houseId: string;
  label: string; // "Modelo — Localização" (instância casada por ordem)
  emd: string | null;
  lotClose: string | null;
  permitApp: string | null;
  permitIssued: string | null;
  buildStart: string | null;
  buildEnd: string | null;
  sale: string | null;
};

export type ScheduleBaseline = {
  frozenAt: string;
  simName: string;
  scenarioCode: string;
  startDate: string; // âncora (início do pool/sim)
  houses: BaselineHouse[];
  pool: {
    loanClosing: string | null;
    loanPayoff?: string | null; // último payoff previsto (fecha a fase "loan ativo")
    firstReturn: string | null;
    lastReturn: string | null;
  };
};

type SimEvent = { day: number; kind: string; label: string; amount: number };
type SimUnit = { label: string; tEmd?: number; tBuildStart?: number; tCO?: number };
type SimResultLike = { events: SimEvent[]; units: SimUnit[] };

// extração pura: marcos por label de unidade, instâncias ordenadas por dia (casas idênticas
// compartilham o label do motor — a n-ésima ocorrência é a n-ésima casa daquele combo)
export function extractScheduleBaseline(
  result: SimResultLike,
  startDate: Date,
  houses: Array<{ id: string; label: string; createdAt: Date }>,
  meta: { simName: string; scenarioCode: string },
): ScheduleBaseline {
  const dt = (day: number) => {
    const x = new Date(startDate);
    x.setUTCDate(x.getUTCDate() + day);
    return x.toISOString().slice(0, 10);
  };
  const unitLabels = [...new Set(result.units.map((u) => u.label))].sort((a, b) => b.length - a.length);
  const houseOf = (lbl: string) => unitLabels.find((u) => lbl.includes(u)) ?? null;

  // OBRA vem do cronograma FÍSICO das units (tBuildStart → tCO) — os eventos de caixa não
  // servem: o motor represa draws/pagamentos até o closing do loan (bug 17/07: Maragogi
  // com obra pronta antes do loan → todos os pagamentos no mesmo dia → início = fim)
  const unitsByLabel = new Map<string, SimUnit[]>();
  for (const u of result.units) {
    const arr = unitsByLabel.get(u.label) ?? [];
    arr.push(u);
    unitsByLabel.set(u.label, arr);
  }
  for (const arr of unitsByLabel.values()) arr.sort((a, b) => (a.tEmd ?? 0) - (b.tEmd ?? 0));

  const marks = new Map<string, Record<string, number[]>>();
  const push = (label: string, key: string, day: number) => {
    const m = marks.get(label) ?? {};
    (m[key] ??= []).push(day);
    marks.set(label, m);
  };
  let loanClosing: number | null = null;
  let loanPayoff: number | null = null;
  const returns: number[] = [];
  for (const e of result.events) {
    if (e.kind === "BANK_FEE" && loanClosing == null) loanClosing = e.day;
    if (e.kind === "BANK_PAYOFF") loanPayoff = Math.max(loanPayoff ?? 0, e.day);
    if (e.kind === "RETURN") returns.push(e.day);
    const h = houseOf(e.label);
    if (!h) continue;
    if (e.kind === "LOT" && e.label.includes("EMD")) push(h, "emd", e.day);
    else if (e.kind === "LOT" && e.label.includes("closing")) push(h, "lotClose", e.day);
    else if (e.label.includes("Permit application")) push(h, "permitApp", e.day);
    else if (e.label.includes("Permit issued")) push(h, "permitIssued", e.day);
    else if (e.kind === "BANK_DRAW" || (e.kind === "PHASE" && !e.label.includes("Permit"))) push(h, "build", e.day);
    else if (e.kind === "SALE") push(h, "sale", e.day);
  }

  // casa do pool ↔ instância prevista: mesmo label (modelo — localização), ordem de criação
  const byLabel = new Map<string, Array<{ id: string; createdAt: Date }>>();
  for (const h of houses) {
    const arr = byLabel.get(h.label) ?? [];
    arr.push(h);
    byLabel.set(h.label, arr);
  }
  const out: BaselineHouse[] = [];
  for (const [label, hs] of byLabel) {
    hs.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    const m = marks.get(label) ?? {};
    const n = hs.length;
    const at = (arr: number[] | undefined, i: number) => (arr && arr[i] != null ? dt(arr[i]) : null);
    const builds = (m.build ?? []).sort((a, b) => a - b);
    const per = n > 0 ? builds.length / n : 0;
    const us = unitsByLabel.get(label) ?? [];
    hs.forEach((h, i) => {
      const u = us[i];
      out.push({
        houseId: h.id,
        label,
        emd: at(m.emd, i),
        lotClose: at(m.lotClose, i),
        permitApp: at(m.permitApp, i),
        permitIssued: at(m.permitIssued, i),
        // units primeiro; fallback nos eventos de caixa só p/ resultados antigos sem os campos
        buildStart: u?.tBuildStart != null ? dt(u.tBuildStart) : per > 0 ? dt(builds[Math.floor(i * per)]) : null,
        buildEnd: u?.tCO != null ? dt(u.tCO) : per > 0 ? dt(builds[Math.ceil((i + 1) * per) - 1]) : null,
        sale: at(m.sale?.slice().sort((a, b) => a - b), i),
      });
    });
  }
  returns.sort((a, b) => a - b);
  return {
    frozenAt: new Date().toISOString(),
    simName: meta.simName,
    scenarioCode: meta.scenarioCode,
    startDate: startDate.toISOString().slice(0, 10),
    houses: out,
    pool: {
      loanClosing: loanClosing != null ? dt(loanClosing) : null,
      loanPayoff: loanPayoff != null ? dt(loanPayoff) : null,
      firstReturn: returns.length > 0 ? dt(returns[0]) : null,
      lastReturn: returns.length > 0 ? dt(returns[returns.length - 1]) : null,
    },
  };
}

// congela UMA vez: na conversão (pools novos) ou no primeiro acesso ao Cronograma
// (pools já convertidos, como a VHP-II). Nunca sobrescreve um baseline existente.
export async function ensureScheduleBaseline(poolId: string): Promise<ScheduleBaseline | null> {
  const pool = await prisma.investmentPool.findUnique({
    where: { id: poolId },
    include: {
      houses: { include: { catalogModel: true, catalogLocation: true } },
      simulations: { orderBy: { updatedAt: "desc" }, take: 1, select: { name: true, scenarioCode: true, result: true } },
    },
  });
  if (!pool) return null;
  if (pool.scheduleBaseline) {
    const existing = pool.scheduleBaseline as unknown as ScheduleBaseline;
    // backfill one-time (16/07: baselines congelados antes do ciclo do loan não têm o
    // payoff previsto) — SÓ adiciona o marco ausente; nenhum valor congelado é alterado
    if (existing.pool.loanPayoff === undefined) {
      const sim0 = pool.simulations[0];
      const res0 = sim0?.result as SimResultLike | null;
      let loanPayoff: string | null = null;
      if (res0?.events?.length && pool.startDate) {
        const last = res0.events.filter((e) => e.kind === "BANK_PAYOFF").map((e) => e.day);
        if (last.length > 0) {
          const x = new Date(pool.startDate);
          x.setUTCDate(x.getUTCDate() + Math.max(...last));
          loanPayoff = x.toISOString().slice(0, 10);
        }
      }
      existing.pool.loanPayoff = loanPayoff;
      await prisma.investmentPool.update({
        where: { id: poolId },
        data: { scheduleBaseline: JSON.parse(JSON.stringify(existing)) },
      });
    }
    return existing;
  }

  const sim = pool.simulations[0];
  const result = sim?.result as SimResultLike | null;
  if (!sim || !result?.events?.length || !pool.startDate) return null;

  const baseline = extractScheduleBaseline(
    result,
    pool.startDate,
    pool.houses.map((h) => ({
      id: h.id,
      label: `${h.catalogModel?.name ?? "?"} — ${h.catalogLocation?.name ?? "?"}`,
      createdAt: h.createdAt,
    })),
    { simName: sim.name, scenarioCode: sim.scenarioCode },
  );
  await prisma.investmentPool.update({
    where: { id: poolId },
    data: { scheduleBaseline: JSON.parse(JSON.stringify(baseline)) },
  });
  return baseline;
}
