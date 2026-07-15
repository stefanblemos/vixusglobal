import type { SimResult } from "./simulator";

// Fases do projeto (primeira→última casa) + janela real do loan. As fases se SOBREPÕEM
// (esteira/gap) — a soma das durações é maior que o projeto, e isso é o desenho.
// SEGMENTADO (pedido do Stefan, 14/07): cada fase é a UNIÃO dos períodos casa a casa —
// os gaps (rajadas de lote/permit por ciclo da esteira) aparecem como vazio na barra,
// e "ativo" ≠ "ponta a ponta" fica explícito.

export type ProjectPhase = {
  key: string;
  label: string;
  from: number; // início do 1º bloco
  to: number; // fim do último bloco
  segments: Array<[number, number]>; // blocos reais (união, sem sobreposição)
  activeDays: number; // Σ duração dos blocos
};

export type ProjectPhases = {
  phases: ProjectPhase[];
  // janela de exposição a juros: períodos com saldo devedor > 0
  loan: {
    from: number;
    to: number;
    segments: Array<[number, number]>;
    activeDays: number;
    closingDay: number; // closing do loan (term conta daqui)
    termDays: number | null;
    overrunDays: number; // quanto a janela passa do term (0 = dentro)
  } | null;
  totalDays: number;
};

// União de intervalos (merge dos sobrepostos/encostados)
function mergeIntervals(iv: Array<[number, number]>): Array<[number, number]> {
  const s = iv
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of s) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

function phaseOf(key: string, label: string, iv: Array<[number, number]>): ProjectPhase {
  const segments = mergeIntervals(iv);
  const from = segments[0]?.[0] ?? 0;
  const to = segments[segments.length - 1]?.[1] ?? 0;
  return {
    key,
    label,
    from,
    to,
    segments,
    activeDays: segments.reduce((s, [a, b]) => s + (b - a), 0),
  };
}

export function phasesOf(r: SimResult, termMonths?: number | null): ProjectPhases {
  const us = r.units;
  const phases: ProjectPhase[] = [
    phaseOf("lots", "Lotes", us.map((u) => [u.tReq, u.tLotClose])),
    phaseOf("permits", "Permits", us.map((u) => [u.tLotClose, u.tPermitOk])),
    phaseOf("build", "Obra", us.map((u) => [u.tBuildStart, u.tCO])),
    phaseOf("sales", "Vendas", us.map((u) => [u.tCO, u.tCashIn])),
  ];

  // Loan: segmentos onde o saldo devedor fica > 0 (abre no 0→+ e fecha no +→0)
  let loan: ProjectPhases["loan"] = null;
  {
    const iv: Array<[number, number]> = [];
    let openAt: number | null = null;
    // events já vêm ordenados por dia pelo motor
    for (const e of r.events) {
      const has = e.bankBalance > 0.005;
      if (has && openAt == null) openAt = e.day;
      if (!has && openAt != null) {
        iv.push([openAt, e.day]);
        openAt = null;
      }
    }
    if (openAt != null) iv.push([openAt, r.kpis.durationDays]);
    if (iv.length > 0) {
      const segments = mergeIntervals(iv);
      const from = segments[0][0];
      const to = segments[segments.length - 1][1];
      const closingDay = r.kpis.loanClosingDay ?? from;
      const termDays = termMonths ? Math.round(termMonths * 30) : null;
      loan = {
        from,
        to,
        segments,
        activeDays: segments.reduce((s, [a, b]) => s + (b - a), 0),
        closingDay,
        termDays,
        overrunDays: termDays == null ? 0 : Math.max(0, to - (closingDay + termDays)),
      };
    }
  }

  return { phases, loan, totalDays: r.kpis.durationDays };
}

export const daysToMonths = (d: number) => Math.round((d / 30) * 10) / 10;
