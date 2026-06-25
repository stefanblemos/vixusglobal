// Motor de depreciação MACRS (EUA, GDS) com §179 e bonus depreciation.
// Personal property: tabelas de percentual half-year (já embutem 200%/150% DB → SL).
// Real property: straight-line mid-month.

// Tabelas IRS half-year (% do custo depreciável), por vida de recuperação.
const HY: Record<string, number[]> = {
  "3": [33.33, 44.45, 14.81, 7.41],
  "5": [20, 32, 19.2, 11.52, 11.52, 5.76],
  "7": [14.29, 24.49, 17.49, 12.49, 8.93, 8.92, 8.93, 4.46],
  "10": [10, 18, 14.4, 11.52, 9.22, 7.37, 6.55, 6.55, 6.56, 6.55, 3.28],
  "15": [5, 9.5, 8.55, 7.7, 6.93, 6.23, 5.9, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 5.9, 5.91, 2.95],
  "20": [
    3.75, 7.219, 6.677, 6.177, 5.713, 5.285, 4.888, 4.522, 4.462, 4.461, 4.462, 4.461, 4.462,
    4.461, 4.462, 4.461, 4.462, 4.461, 4.462, 4.461, 2.231,
  ],
};

export interface AssetInput {
  cost: number;
  section179: number;
  bonusPct: number;
  recoveryYears: number;
  method: "MACRS" | "SL_MM" | "NONE";
  acquisitionYear: number;
  acquisitionMonth: number; // 1-12 (para mid-month)
}

export interface YearDep {
  year: number;
  amount: number;
}

export interface AssetSchedule {
  cost: number;
  section179: number;
  bonus: number;
  depreciableBasis: number; // após §179 e bonus
  schedule: YearDep[];
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function depreciationSchedule(a: AssetInput): AssetSchedule {
  // Terreno e afins: não deprecia — fica no custo, schedule vazio.
  if (a.method === "NONE") {
    return { cost: a.cost, section179: 0, bonus: 0, depreciableBasis: a.cost, schedule: [], total: 0 };
  }
  const s179 = Math.min(Math.max(a.section179, 0), a.cost);
  const afterS179 = a.cost - s179;
  const bonus = round2(afterS179 * (Math.max(0, Math.min(a.bonusPct, 100)) / 100));
  const depreciableBasis = round2(afterS179 - bonus);

  const yearly: number[] = [];
  if (a.method === "SL_MM") {
    // Straight-line mid-month: 1º e último ano proporcionais ao mês colocado em serviço.
    const life = a.recoveryYears;
    const annual = depreciableBasis / life;
    const firstFraction = (12 - a.acquisitionMonth + 0.5) / 12;
    let remaining = depreciableBasis;
    let amt = round2(annual * firstFraction);
    yearly.push(amt);
    remaining -= amt;
    let guard = 0;
    while (remaining > 0.005 && guard < Math.ceil(life) + 2) {
      amt = round2(Math.min(annual, remaining));
      yearly.push(amt);
      remaining -= amt;
      guard += 1;
    }
  } else {
    const table = HY[String(a.recoveryYears)] ?? HY["7"];
    for (const pct of table) yearly.push(round2((depreciableBasis * pct) / 100));
  }

  const schedule: YearDep[] = yearly.map((amt, i) => ({
    year: a.acquisitionYear + i,
    amount: round2(amt + (i === 0 ? s179 + bonus : 0)),
  }));

  return {
    cost: a.cost,
    section179: s179,
    bonus,
    depreciableBasis,
    schedule,
    total: round2(schedule.reduce((s, y) => s + y.amount, 0)),
  };
}

export function depreciationForYear(s: AssetSchedule, year: number): number {
  return s.schedule.find((y) => y.year === year)?.amount ?? 0;
}

export function accumulatedThrough(s: AssetSchedule, year: number): number {
  return round2(s.schedule.filter((y) => y.year <= year).reduce((sum, y) => sum + y.amount, 0));
}
