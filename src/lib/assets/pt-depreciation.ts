// Motor de depreciação de Portugal — método das quotas constantes (linha reta),
// nos termos do Decreto Regulamentar 25/2009. Diferenças vs MACRS (EUA):
//  • taxa anual fixa (ex.: 2% edifícios comerciais) até esgotar a base — sem §179/bonus;
//  • o TERRENO não deprecia: a parcela de terreno é separada do custo (landValue);
//  • no ano de início de utilização pode-se usar a quota anual cheia OU duodécimos
//    (proporcional aos meses de uso) — art. 7.º. Default aqui = quota cheia.

export interface PtAssetInput {
  cost: number; // custo de aquisição (inclui IMT, escritura, benfeitorias capitalizadas)
  landValue: number; // parcela de terreno (não deprecia)
  ratePct: number; // taxa anual de depreciação (%) — ex.: 2 (edifício), 25 (viatura)
  acquisitionYear: number;
  acquisitionMonth: number; // 1-12 (para duodécimos no 1º ano)
  firstYearProRata?: boolean; // true = duodécimos no ano de entrada em uso
}

export interface YearDep {
  year: number;
  amount: number;
}

export interface PtAssetSchedule {
  cost: number;
  landValue: number;
  depreciableBasis: number; // custo − terreno
  ratePct: number;
  annualQuota: number; // quota anual cheia (base × taxa)
  schedule: YearDep[];
  total: number; // = depreciableBasis (linha reta esgota a base)
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function ptDepreciationSchedule(a: PtAssetInput): PtAssetSchedule {
  const land = Math.max(0, Math.min(a.landValue, a.cost));
  const depreciableBasis = round2(a.cost - land);
  const rate = Math.max(0, a.ratePct) / 100;
  const annualQuota = round2(depreciableBasis * rate);

  const schedule: YearDep[] = [];
  if (annualQuota > 0 && depreciableBasis > 0) {
    let remaining = depreciableBasis;
    let year = a.acquisitionYear;

    // 1º ano: quota cheia ou duodécimos (meses de uso, incluindo o mês de entrada).
    const firstFraction = a.firstYearProRata
      ? (12 - Math.max(1, Math.min(12, a.acquisitionMonth)) + 1) / 12
      : 1;
    let amt = round2(Math.min(annualQuota * firstFraction, remaining));
    schedule.push({ year, amount: amt });
    remaining = round2(remaining - amt);
    year += 1;

    let guard = 0;
    const maxYears = Math.ceil(100 / Math.max(0.01, a.ratePct)) + 2;
    while (remaining > 0.005 && guard < maxYears) {
      amt = round2(Math.min(annualQuota, remaining));
      schedule.push({ year, amount: amt });
      remaining = round2(remaining - amt);
      year += 1;
      guard += 1;
    }
  }

  return {
    cost: a.cost,
    landValue: land,
    depreciableBasis,
    ratePct: a.ratePct,
    annualQuota,
    schedule,
    total: round2(schedule.reduce((s, y) => s + y.amount, 0)),
  };
}

export function ptDepreciationForYear(s: PtAssetSchedule, year: number): number {
  return s.schedule.find((y) => y.year === year)?.amount ?? 0;
}

export function ptAccumulatedThrough(s: PtAssetSchedule, year: number): number {
  return round2(s.schedule.filter((y) => y.year <= year).reduce((sum, y) => sum + y.amount, 0));
}
