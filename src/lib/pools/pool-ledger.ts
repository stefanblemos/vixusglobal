/**
 * Extrato único do pool (etapa 3, mock aprovado 05/10/2026): PROJEÇÃO dos fatos que já existem
 * — aportes dos sócios, capital próprio colocado nas casas (HouseCashEntry), líquido das vendas,
 * despesas do pool e distribuições — como um só extrato de caixa com saldo corrido. Não há
 * tabela nova: o que mexe no caixa do pool já está gravado em algum lugar; aqui só se junta.
 *
 * Movimentos do BANCO (draws, payoff, juros pagos pela reserve, fees) não passam pelo caixa
 * do pool — ficam na aba Banco. O que o banco pagou direto à obra aparece no extrato da casa.
 */

export type PoolLedgerRow = {
  date: string | null; // ISO; null = abertura (valor da ficha antiga, sem data real)
  label: string;
  houseId: string | null;
  house: string | null; // endereço
  source: "MEMBER" | "HOUSE" | "SALE" | "POOL";
  cat: "MEMBERS" | "HOUSES" | "SALES" | "EXPENSES" | "DIST";
  inAmount: number | null;
  outAmount: number | null;
  opening: boolean;
};

type Dec = unknown;
const n = (v: Dec) => (v == null ? 0 : Number(v));
const r2 = (v: number) => Math.round(v * 100) / 100;
const iso = (d: Date) => d.toISOString().slice(0, 10);

export function buildPoolLedger(args: {
  members: Array<{
    name: string;
    role: "MANAGER" | "INVESTOR";
    entries: Array<{ kind: string; date: Date; amount: Dec }>;
  }>;
  houses: Array<{
    id: string;
    address: string;
    ownCapital: Dec | null;
    saleDate: Date | null;
    soldPrice: Dec | null;
    payoffAmount: Dec | null;
    netReceived: Dec | null;
    closingCost: Dec | null;
    cashEntries: Array<{ kind: string; date: Date; opening: boolean; amount: Dec; memo: string | null }>;
  }>;
  expenses: Array<{ date: Date; description: string; amount: Dec; status: string }>;
  distributions: Array<{ date: Date; kind: string; totalAmount: Dec }>;
}) {
  const rows: PoolLedgerRow[] = [];

  for (const m of args.members)
    for (const e of m.entries) {
      if (e.kind === "TRANSFER_IN" || e.kind === "TRANSFER_OUT") continue; // troca entre sócios, caixa não muda
      rows.push({
        date: iso(e.date),
        label: `${e.kind === "CAPITAL_CALL" ? "Capital call" : "Aporte"} · ${m.name}${m.role === "MANAGER" ? " (Manager)" : ""}`,
        houseId: null, house: null, source: "MEMBER", cat: "MEMBERS",
        inAmount: n(e.amount), outAmount: null, opening: false,
      });
    }

  for (const h of args.houses) {
    for (const e of h.cashEntries) {
      if (e.kind === "EQUITY_IN")
        rows.push({
          date: e.opening ? null : iso(e.date),
          label: e.opening ? "Capital próprio p/ a casa (abertura)" : `Capital próprio p/ a casa${e.memo ? ` · ${e.memo}` : ""}`,
          houseId: h.id, house: h.address, source: "HOUSE", cat: "HOUSES",
          inAmount: null, outAmount: n(e.amount), opening: e.opening,
        });
      else if (e.kind === "RETURN_TO_POOL")
        rows.push({
          date: iso(e.date), label: "Excedente devolvido pela casa",
          houseId: h.id, house: h.address, source: "HOUSE", cat: "HOUSES",
          inAmount: n(e.amount), outAmount: null, opening: false,
        });
    }
    // venda: o que ENTROU em conta (netReceived informado; senão venda − payoff − closing)
    const net =
      h.netReceived != null ? n(h.netReceived)
      : h.soldPrice != null ? n(h.soldPrice) - n(h.payoffAmount) - n(h.closingCost)
      : null;
    if (h.saleDate && net != null)
      rows.push({
        date: iso(h.saleDate),
        label: `Venda · líquido recebido${h.soldPrice != null ? ` (venda ${fmt0(n(h.soldPrice))}${n(h.payoffAmount) ? ` − payoff ${fmt0(n(h.payoffAmount))}` : ""})` : ""}`,
        houseId: h.id, house: h.address, source: "SALE", cat: "SALES",
        inAmount: r2(net), outAmount: null, opening: false,
      });
  }

  for (const e of args.expenses)
    if (e.status === "PAID")
      rows.push({
        date: iso(e.date), label: `Despesa · ${e.description}`, houseId: null, house: null,
        source: "POOL", cat: "EXPENSES", inAmount: null, outAmount: n(e.amount), opening: false,
      });

  for (const x of args.distributions)
    rows.push({
      date: iso(x.date), label: `Distribuição · ${x.kind === "PROFIT" ? "lucro" : "devolução de capital"}`,
      houseId: null, house: null, source: "MEMBER", cat: "DIST", inAmount: null, outAmount: n(x.totalAmount), opening: false,
    });

  // aberturas primeiro (sem data), depois por data; no mesmo dia entrada antes de saída
  rows.sort((a, b) => {
    if (a.date == null || b.date == null) return a.date == null ? (b.date == null ? 0 : -1) : 1;
    return a.date.localeCompare(b.date) || (a.inAmount ? -1 : 1) - (b.inAmount ? -1 : 1);
  });

  const totalIn = r2(rows.reduce((s, r) => s + (r.inAmount ?? 0), 0));
  const totalOut = r2(rows.reduce((s, r) => s + (r.outAmount ?? 0), 0));
  const raised = r2(rows.filter((r) => r.cat === "MEMBERS").reduce((s, r) => s + (r.inAmount ?? 0), 0));
  const inHousesAll = r2(args.houses.reduce((s, h) => s + n(h.ownCapital), 0));
  return {
    rows,
    totalIn,
    totalOut,
    cash: r2(totalIn - totalOut),
    raised,
    // conferência: capital colocado nas casas acima do captado = aporte que falta lançar
    gap: r2(inHousesAll - raised),
    openingCount: rows.filter((r) => r.opening).length,
  };
}

const fmt0 = (v: number) => "$" + Math.round(v).toLocaleString("en-US");
