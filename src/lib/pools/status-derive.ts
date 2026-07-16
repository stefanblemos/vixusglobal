/**
 * Derivação automática de status (aprovado 16/07): status é REFLEXO dos fatos, nunca um
 * campo que o Stefan mantém. Clicar no stepper carimba o FATO (data); o status se deriva.
 *
 * Casa: fase mais alta cujo gatilho existe. % de obra = draws creditados ÷ loan da casa
 * (CO preenchido assume 100% mesmo sem todos os draws — pedido A).
 * Pool: Funding → Active (1ª casa com lote — fecha entrada de sócios novos; aportes de
 * quem já participa continuam) → Closing (todas vendidas) → Closed (loans quitados +
 * lucro distribuído + caixa devolvido).
 */

export type HouseFacts = {
  lotPaidDate: Date | null;
  actualLotCost: unknown | null;
  buildStartDate: Date | null;
  coDate: Date | null;
  contractDate: Date | null;
  saleDate: Date | null;
  soldPrice: unknown | null;
  netReceived: unknown | null;
  bankLoanAmount: unknown | null;
};

export type HouseStatusValue =
  | "PLANNED"
  | "LOT_PURCHASED"
  | "UNDER_CONSTRUCTION"
  | "FOR_SALE"
  | "UNDER_CONTRACT"
  | "SOLD";

export function deriveHouseStatus(
  h: HouseFacts,
  drawsCredited: number,
  hasPayoff: boolean,
): HouseStatusValue {
  const sold = (h.saleDate != null && (h.soldPrice != null || h.netReceived != null)) || hasPayoff;
  if (sold) return "SOLD";
  if (h.contractDate != null) return "UNDER_CONTRACT";
  if (h.coDate != null) return "FOR_SALE";
  if (h.buildStartDate != null || drawsCredited > 0) return "UNDER_CONSTRUCTION";
  if (h.lotPaidDate != null || h.actualLotCost != null) return "LOT_PURCHASED";
  return "PLANNED";
}

// % de conclusão da obra pelos RECEBIMENTOS do banco (pedido A). CO emitido = 100%,
// mesmo sem 100% dos draws. Sem loan (equity) e sem CO → null (sem régua).
export function buildProgressPct(
  h: Pick<HouseFacts, "coDate" | "bankLoanAmount">,
  drawsCredited: number,
): number | null {
  if (h.coDate != null) return 100;
  const budget = h.bankLoanAmount != null ? Number(h.bankLoanAmount) : 0;
  if (budget <= 0) return drawsCredited > 0 ? null : null;
  return Math.min(100, Math.round((drawsCredited / budget) * 100));
}

const HOUSE_ORDER: HouseStatusValue[] = [
  "PLANNED",
  "LOT_PURCHASED",
  "UNDER_CONSTRUCTION",
  "FOR_SALE",
  "UNDER_CONTRACT",
  "SOLD",
];
export const houseStatusRank = (s: string) => HOUSE_ORDER.indexOf(s as HouseStatusValue);

export type PoolStatusValue = "FUNDING" | "ACTIVE" | "CLOSING" | "CLOSED";

export function derivePoolStatus(args: {
  houseStatuses: string[];
  allLoansPaidOff: boolean; // todos os loans com saldo ≤ 0 (ou sem loans com atividade)
  hasProfitDistribution: boolean;
  freeToReturn: number; // caixa livre p/ devolução (≈0 = tudo devolvido)
}): PoolStatusValue {
  const { houseStatuses } = args;
  const total = houseStatuses.length;
  const sold = houseStatuses.filter((s) => s === "SOLD").length;
  const started = houseStatuses.filter((s) => houseStatusRank(s) >= 1).length;
  if (total > 0 && sold === total) {
    if (args.allLoansPaidOff && args.hasProfitDistribution && Math.abs(args.freeToReturn) < 1)
      return "CLOSED";
    return "CLOSING";
  }
  if (started > 0) return "ACTIVE";
  return "FUNDING";
}

// contadores x/x para os subtítulos do stepper do pool (pedido B)
export function poolPhaseCounters(houseStatuses: string[]) {
  return {
    total: houseStatuses.length,
    started: houseStatuses.filter((s) => houseStatusRank(s) >= 1).length,
    sold: houseStatuses.filter((s) => s === "SOLD").length,
  };
}
