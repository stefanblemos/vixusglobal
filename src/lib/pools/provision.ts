import type { SimResult } from "@/lib/pools/simulator";

// Provisão de recursos (16/07 — mock aprovado pelo Stefan): explica AO SÓCIO por que a
// captação tem o tamanho que tem. Atribuição just-in-time: cada aporte paga as saídas do
// MESMO DIA — agregando por natureza, a soma fecha exatamente com o total chamado.
// Módulo puro (só SimResult) — candidato natural ao pacote standalone se a 4U pedir.

export type ProvisionNature =
  | "LOT" // lotes (caução + closing)
  | "PHASE" // obra paga com equity (fases fora do banco)
  | "BANK_FEE" // fees do banco em caixa (cash to close)
  | "BANK_INTEREST" // juros pagos em caixa
  | "BANK_PAYOFF" // complemento de quitação (ponte venda × payoff)
  | "VEHICLE" // custos do veículo (LLC/contador/annual report)
  | "CONTINGENCY" // reserva de contingência
  | "OTHER";

export type ProvisionData = {
  total: number; // capital total chamado (soma dos aportes)
  byNature: Array<{ nature: ProvisionNature; amount: number; pct: number }>;
  monthlyCalls: Array<{ month: number; amount: number; cumulative: number }>;
  peakDay: number; // dia de exposição máxima
  firstReturn: { day: number; amount: number } | null;
  houses: Array<{
    label: string;
    count: number; // casas idênticas (mesmo modelo×location) agrupadas — o label do motor não as distingue
    lot: number; // LOT (caução + closing)
    buildEquity: number; // PHASE (fases pagas pelo caixa/equity)
    buildBank: number; // BANK_DRAW (obra desembolsada pelo banco)
    saleNet: number; // entrada da venda
    equityTotal: number; // lot + buildEquity — a fatia da casa na provisão
    lotCloseDay: number | null;
    saleDay: number | null;
  }>;
  programLines: Array<{ nature: ProvisionNature; amount: number }>; // linhas sem casa (fees/juros/payoff/veículo)
  monthlyInterest: Array<{ month: number; amount: number; cumulative: number }>;
};

const round2 = (v: number) => Math.round(v * 100) / 100;

// extrai o label da casa do label do evento — nem sempre no fim (fases têm sufixo, ex.:
// "Fase 1 • … • Maragogi - T2 — Rolling Hills (equity — banco reembolsa)"); busca por
// inclusão, do label mais longo p/ o mais curto (evita casar prefixos de nomes parecidos)
function houseOf(label: string, unitsByLength: string[]): string | null {
  for (const u of unitsByLength) if (label.includes(u)) return u;
  return null;
}

export function provisionOf(r: SimResult): ProvisionData {
  // casas idênticas (mesma combinação) compartilham o label nos eventos do motor — os
  // valores delas chegam somados; agrupamos numa linha só, com a contagem explícita
  const labelCount = new Map<string, number>();
  for (const u of r.units) labelCount.set(u.label, (labelCount.get(u.label) ?? 0) + 1);
  const unitLabels = [...labelCount.keys()].sort((a, b) => b.length - a.length);

  // ── atribuição por natureza E por casa: aporte do dia rateado pelas saídas do dia ──
  // No modo banco, as fases de obra saem TODAS do caixa e o draw do banco reembolsa —
  // por isso a fatia da casa na provisão é o ATRIBUÍDO dos aportes, não a fase bruta.
  const porDia = new Map<number, { inj: number; outs: Array<{ kind: string; house: string | null; amount: number }> }>();
  for (const e of r.events) {
    const d = porDia.get(e.day) ?? { inj: 0, outs: [] };
    if (e.kind === "INJECTION") d.inj += e.amount;
    else if (e.amount < 0 && e.kind !== "RETURN")
      d.outs.push({ kind: e.kind, house: houseOf(e.label, unitLabels), amount: -e.amount });
    porDia.set(e.day, d);
  }
  const natureza = new Map<string, number>();
  const casaEquity = new Map<string, { lot: number; build: number }>();
  for (const u of unitLabels) casaEquity.set(u, { lot: 0, build: 0 });
  let total = 0;
  for (const [, d] of porDia) {
    if (d.inj <= 0) continue;
    total += d.inj;
    const outTotal = d.outs.reduce((s, o) => s + o.amount, 0);
    if (outTotal <= 0) {
      natureza.set("OTHER", (natureza.get("OTHER") ?? 0) + d.inj);
      continue;
    }
    for (const o of d.outs) {
      const share = d.inj * (o.amount / outTotal);
      natureza.set(o.kind, (natureza.get(o.kind) ?? 0) + share);
      if (o.house) {
        const c = casaEquity.get(o.house)!;
        if (o.kind === "LOT") c.lot += share;
        else if (o.kind === "PHASE" || o.kind === "CONTINGENCY") c.build += share;
      }
    }
  }
  const KNOWN: ProvisionNature[] = ["LOT", "PHASE", "BANK_FEE", "BANK_INTEREST", "BANK_PAYOFF", "VEHICLE", "CONTINGENCY"];
  const byNature = [...natureza.entries()]
    .map(([k, amount]) => ({
      nature: (KNOWN.includes(k as ProvisionNature) ? k : "OTHER") as ProvisionNature,
      amount: round2(amount),
      pct: total > 0 ? amount / total : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  // ── chamadas por mês ──
  const mensal = new Map<number, number>();
  let peak = 0;
  let peakDay = 0;
  let firstReturn: ProvisionData["firstReturn"] = null;
  for (const e of r.events) {
    if (e.kind === "INJECTION") {
      const m = Math.floor(e.day / 30) + 1;
      mensal.set(m, (mensal.get(m) ?? 0) + e.amount);
    }
    if (e.invested > peak) {
      peak = e.invested;
      peakDay = e.day;
    }
    if (!firstReturn && e.kind === "RETURN") firstReturn = { day: e.day, amount: round2(-e.amount) };
  }
  let cum = 0;
  const monthlyCalls = [...mensal.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month, amount]) => {
      cum += amount;
      return { month, amount: round2(amount), cumulative: round2(cum) };
    });

  // ── explodido por casa (sustentação): equity ATRIBUÍDO + colunas informativas brutas ──
  const casa = new Map<string, { buildBank: number; saleNet: number; lotCloseDay: number | null; saleDay: number | null }>();
  for (const u of unitLabels) casa.set(u, { buildBank: 0, saleNet: 0, lotCloseDay: null, saleDay: null });
  for (const e of r.events) {
    const h = houseOf(e.label, unitLabels);
    if (!h) continue;
    const c = casa.get(h)!;
    if (e.kind === "LOT") c.lotCloseDay = e.day; // o último evento de lote é o closing
    else if (e.kind === "BANK_DRAW") c.buildBank += Math.abs(e.amount);
    else if (e.kind === "SALE") {
      c.saleNet += e.amount;
      c.saleDay = e.day;
    }
  }
  const houses = unitLabels.map((label) => {
    const c = casa.get(label)!;
    const eq = casaEquity.get(label)!;
    return {
      label,
      count: labelCount.get(label) ?? 1,
      lot: round2(eq.lot),
      buildEquity: round2(eq.build),
      buildBank: round2(c.buildBank),
      saleNet: round2(c.saleNet),
      equityTotal: round2(eq.lot + eq.build),
      lotCloseDay: c.lotCloseDay,
      saleDay: c.saleDay,
    };
  });

  const programLines = byNature
    .filter((n) => !["LOT", "PHASE"].includes(n.nature))
    .map(({ nature, amount }) => ({ nature, amount }));

  // ── juros mês a mês (BANK_INTEREST é agregado por mês no motor) ──
  const jurosMes = new Map<number, number>();
  for (const e of r.events) {
    if (e.kind === "BANK_INTEREST" && e.amount < 0) {
      const m = Math.floor(e.day / 30) + 1;
      jurosMes.set(m, (jurosMes.get(m) ?? 0) + -e.amount);
    }
  }
  let jcum = 0;
  const monthlyInterest = [...jurosMes.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([month, amount]) => {
      jcum += amount;
      return { month, amount: round2(amount), cumulative: round2(jcum) };
    });

  return {
    total: round2(total),
    byNature,
    monthlyCalls,
    peakDay,
    firstReturn,
    houses,
    programLines,
    monthlyInterest,
  };
}

export const NATURE_LABEL: Record<ProvisionNature, { label: string; why: string; color: string }> = {
  PHASE: {
    label: "Obra (equity)",
    why: "Permit application e fases até o closing do loan + o que passa do LTC — o banco só desembolsa depois de fechar, contra medição.",
    color: "#f59e0b",
  },
  LOT: {
    label: "Lotes (caução + closing)",
    why: "O banco não financia terreno — lote é 100% capital próprio, e é o que destrava o permit.",
    color: "#1f3a5f",
  },
  BANK_FEE: {
    label: "Fees do banco em caixa",
    why: "Cash to close: origination/underwriting não financiados saem do caixa no closing de cada loan.",
    color: "#64748b",
  },
  BANK_INTEREST: {
    label: "Juros pagos em caixa",
    why: "Juros mensais sobre o sacado enquanto a casa não vende (sem interest reserve financiada).",
    color: "#94a3b8",
  },
  BANK_PAYOFF: {
    label: "Complemento de payoff",
    why: "Quando o dinheiro da venda entra dias depois da quitação, o caixa cobre a ponte.",
    color: "#cbd5e1",
  },
  VEHICLE: {
    label: "Custos do veículo",
    why: "Abertura da LLC, contador e annual report — modelados como fluxos datados.",
    color: "#16a34a",
  },
  CONTINGENCY: {
    label: "Reserva de contingência",
    why: "Colchão do cenário — devolvido se não for usado.",
    color: "#a855f7",
  },
  OTHER: { label: "Outros", why: "", color: "#e2e8f0" },
};
