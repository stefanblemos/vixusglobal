import type { SimResult } from "@/lib/pools/simulator";

// Fases do projeto (primeira→última casa) + janela real do loan. As fases se SOBREPÕEM
// (esteira/gap) — a soma das durações é maior que o projeto, e isso é o desenho.
// Aprovado pelo Stefan em 13/07/2026 (mock): responde "o loan não entra no período todo".

export type ProjectPhase = { key: string; label: string; from: number; to: number };

export type ProjectPhases = {
  phases: ProjectPhase[];
  // janela de exposição a juros: 1º dia com saldo devedor → dia em que zera
  loan: {
    from: number;
    to: number;
    closingDay: number; // closing do loan (term conta daqui)
    termDays: number | null;
    overrunDays: number; // quanto a janela passa do term (0 = dentro)
  } | null;
  totalDays: number;
};

export function phasesOf(r: SimResult, termMonths?: number | null): ProjectPhases {
  const us = r.units;
  const min = (f: (u: SimResult["units"][number]) => number) => Math.min(...us.map(f));
  const max = (f: (u: SimResult["units"][number]) => number) => Math.max(...us.map(f));
  const phases: ProjectPhase[] = [
    // tEmd pode faltar em snapshot antigo (pré-13/07) — cai no tReq
    { key: "lots", label: "Lotes", from: min((u) => u.tReq), to: max((u) => u.tLotClose) },
    { key: "permits", label: "Permits", from: min((u) => u.tLotClose), to: max((u) => u.tPermitOk) },
    { key: "build", label: "Obra", from: min((u) => u.tBuildStart), to: max((u) => u.tCO) },
    { key: "sales", label: "Vendas", from: min((u) => u.tCO), to: max((u) => u.tCashIn) },
  ];

  const debtDays = r.events.filter((e) => e.bankBalance > 0.005).map((e) => e.day);
  let loan: ProjectPhases["loan"] = null;
  if (debtDays.length > 0) {
    const from = Math.min(...debtDays);
    const to = Math.max(...debtDays);
    const closingDay = r.kpis.loanClosingDay ?? from;
    const termDays = termMonths ? Math.round(termMonths * 30) : null;
    loan = {
      from,
      to,
      closingDay,
      termDays,
      overrunDays: termDays == null ? 0 : Math.max(0, to - (closingDay + termDays)),
    };
  }

  return { phases, loan, totalDays: r.kpis.durationDays };
}

export const daysToMonths = (d: number) => Math.round((d / 30) * 10) / 10;
