import { D, ZERO, type Decimal, type DecimalInput } from "@/lib/money";

/**
 * Matemática dos investment pools. Fonte única da posição de cada sócio:
 * units = Σ CONTRIBUTION + Σ TRANSFER_IN − Σ TRANSFER_OUT (idem para o capital).
 * O % de participação é SEMPRE derivado das units — nunca digitado.
 */

export type PoolEntryLike = {
  kind: "CONTRIBUTION" | "TRANSFER_IN" | "TRANSFER_OUT" | "CAPITAL_CALL";
  amount: DecimalInput;
  units: DecimalInput;
};

export type MemberLike = {
  id: string;
  role: "MANAGER" | "INVESTOR";
  party: { name: string } | null;
  company: { legalName: string } | null;
  entries: PoolEntryLike[];
};

export type CapTableRow = {
  memberId: string;
  name: string;
  role: "MANAGER" | "INVESTOR";
  units: Decimal;
  invested: Decimal;
  pct: Decimal; // 0–100
};

export function memberName(m: { party: { name: string } | null; company: { legalName: string } | null }): string {
  return m.party?.name ?? m.company?.legalName ?? "(unknown)";
}

/** Posição líquida (units + capital) de uma lista de lançamentos. */
export function position(entries: PoolEntryLike[]): { units: Decimal; invested: Decimal } {
  let units = ZERO;
  let invested = ZERO;
  for (const e of entries) {
    const sign = e.kind === "TRANSFER_OUT" ? -1 : 1;
    units = units.add(D(e.units).mul(sign));
    invested = invested.add(D(e.amount).mul(sign));
  }
  return { units, invested };
}

/** Cap table do pool: uma linha por sócio, % derivado das units. */
export function capTable(members: MemberLike[]): { rows: CapTableRow[]; totalUnits: Decimal; totalInvested: Decimal } {
  const rows = members.map((m) => {
    const p = position(m.entries);
    return {
      memberId: m.id,
      name: memberName(m),
      role: m.role,
      units: p.units,
      invested: p.invested,
      pct: ZERO as Decimal,
    };
  });
  const totalUnits = rows.reduce((s, r) => s.add(r.units), ZERO);
  const totalInvested = rows.reduce((s, r) => s.add(r.invested), ZERO);
  for (const r of rows) {
    r.pct = totalUnits.isZero() ? ZERO : r.units.div(totalUnits).mul(100);
  }
  rows.sort((a, b) => (a.role !== b.role ? (a.role === "MANAGER" ? -1 : 1) : b.units.cmp(a.units)));
  return { rows, totalUnits, totalInvested };
}

type HouseLike = {
  plannedLotCost: DecimalInput | null;
  plannedBuildCost: DecimalInput | null;
  plannedSalePrice: DecimalInput | null;
  plannedClosingCost: DecimalInput | null;
  bankLoanAmount: DecimalInput | null;
  ownCapital: DecimalInput | null;
  actualLotCost: DecimalInput | null;
  actualBuildCost: DecimalInput | null;
  soldPrice: DecimalInput | null;
  payoffAmount: DecimalInput | null;
  netReceived: DecimalInput | null;
  closingCost: DecimalInput | null;
};

/**
 * Economia de UMA casa.
 * - plannedProfit: pro forma (venda − lote − obra − closing) — só quando há CUSTO
 *   cadastrado (venda sozinha não é lucro).
 * - cashAtClosing: o que entrou em conta na venda (netReceived informado, ou
 *   venda − payoff − closing). É CAIXA, não lucro: com sweep pooled do banco, o payoff
 *   de uma casa amortiza dívida das outras.
 * - realProfit: lucro POR CUSTO (venda − closing − lote real − obra real − change orders)
 *   — a medida correta por casa; precisa dos custos reais preenchidos. Não considera
 *   juros/fees do loan (que são do pool, não da casa).
 */
export function houseEconomics(h: HouseLike, changeOrdersTotal: DecimalInput = 0) {
  const hasPlannedCost = h.plannedLotCost != null || h.plannedBuildCost != null;
  const plannedCost = [h.plannedLotCost, h.plannedBuildCost, h.plannedClosingCost]
    .filter((v) => v != null)
    .reduce<Decimal>((s, v) => s.add(D(v!)), ZERO);
  const plannedProfit =
    h.plannedSalePrice == null || !hasPlannedCost ? null : D(h.plannedSalePrice).sub(plannedCost);
  const ownCapitalNeeded = !hasPlannedCost ? null : plannedCost.sub(D(h.bankLoanAmount ?? 0));
  const cashAtClosing =
    h.netReceived != null
      ? D(h.netReceived)
      : h.soldPrice == null
        ? null
        : D(h.soldPrice).sub(D(h.payoffAmount ?? 0)).sub(D(h.closingCost ?? 0));
  const hasActualCost = h.actualLotCost != null || h.actualBuildCost != null;
  const changeOrders = D(changeOrdersTotal);
  const realProfit =
    h.soldPrice == null || !hasActualCost
      ? null
      : D(h.soldPrice)
          .sub(D(h.closingCost ?? 0))
          .sub(D(h.actualLotCost ?? 0))
          .sub(D(h.actualBuildCost ?? 0))
          .sub(changeOrders);
  return { plannedCost, plannedProfit, ownCapitalNeeded, cashAtClosing, realProfit, changeOrders };
}

/** Numeral romano para o código sequencial dos pools (VHP-I, VHP-II…). */
export function roman(n: number): string {
  const table: Array<[number, string]> = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
    [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
  ];
  let out = "";
  let rest = Math.max(1, Math.floor(n));
  for (const [v, s] of table) {
    while (rest >= v) {
      out += s;
      rest -= v;
    }
  }
  return out;
}
