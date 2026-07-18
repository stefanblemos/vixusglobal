/**
 * Feed do pool (Fase 0 do roadmap investor-grade, 18/07): a timeline "o que aconteceu"
 * derivada dos dados que JÁ existem — nenhum registro novo. Módulo puro: alimenta o
 * Overview e vira a seção narrativa do report mensal.
 */

type Dec = unknown;
const n = (v: Dec) => (v == null ? 0 : Number(v));

export type FeedEvent = {
  date: Date;
  icon: string; // emoji da categoria
  text: string;
  tone: "money" | "house" | "loan" | "doc" | "dist" | "expense";
};

export type FeedInput = {
  members: Array<{
    name: string;
    entries: Array<{ kind: string; date: Date; amount: Dec }>;
  }>;
  loans: Array<{
    bankName: string | null;
    entries: Array<{ type: string; date: Date; amount: Dec; pending: boolean; houseAddress?: string | null }>;
    documents?: Array<{ kind: string; fileName: string; createdAt: Date }>;
  }>;
  houses: Array<{
    address: string;
    lotContractDate: Date | null;
    lotPaidDate: Date | null;
    actualLotCost: Dec;
    permitAppliedDate: Date | null;
    permitIssuedDate: Date | null;
    buildStartDate: Date | null;
    coDate: Date | null;
    listedDate: Date | null;
    contractDate: Date | null;
    saleDate: Date | null;
    soldPrice: Dec;
  }>;
  distributions: Array<{ date: Date; amount: Dec }>;
  expenses: Array<{ date: Date; description: string; amount: Dec; status: string }>;
  currency: string;
};

const money = (v: number, cur: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: cur, maximumFractionDigits: 0 }).format(v);

const LOAN_EVENT_TYPES: Record<string, string> = {
  DRAW: "Draw creditado",
  PAYOFF: "Payoff do loan",
  INTEREST_PAYMENT: "Juros pagos",
  CLOSING_FEE: "Fees do closing lançados",
  RESERVE: "Interest reserve capitalizada",
  OTHER: "Lançamento no loan",
  RECONVEYANCE: "Reconveyance (release)",
  CREDIT: "Crédito do banco",
};

export function buildActivityFeed(input: FeedInput, limit = 20): { events: FeedEvent[]; total: number } {
  const cur = input.currency;
  const ev: FeedEvent[] = [];

  for (const m of input.members) {
    for (const e of m.entries) {
      if (e.kind === "CONTRIBUTION")
        ev.push({ date: e.date, icon: "💰", tone: "money", text: `Aporte de ${money(n(e.amount), cur)} — ${m.name}` });
      else if (e.kind === "CAPITAL_CALL")
        ev.push({ date: e.date, icon: "📣", tone: "money", text: `Capital call de ${money(n(e.amount), cur)} — ${m.name}` });
    }
  }

  for (const l of input.loans) {
    const bank = l.bankName?.split(" ")[0] ?? "banco";
    for (const e of l.entries.filter((x) => !x.pending)) {
      const label = LOAN_EVENT_TYPES[e.type];
      if (!label) continue; // juros cobrados/fees de draw = ruído; o statement tem tudo
      const casa = e.houseAddress ? ` · ${e.houseAddress.split(",")[0]}` : "";
      ev.push({
        date: e.date,
        icon: "🏦",
        tone: "loan",
        text: `${label} — ${money(Math.abs(n(e.amount)), cur)} (${bank})${casa}`,
      });
    }
    for (const d of l.documents ?? []) {
      ev.push({
        date: d.createdAt,
        icon: "📄",
        tone: "doc",
        text: `Documento lido — ${d.fileName} (${bank} · ${d.kind})`,
      });
    }
  }

  for (const h of input.houses) {
    const casa = h.address.split(",")[0];
    const push = (date: Date | null, text: string) =>
      date && ev.push({ date, icon: "🏠", tone: "house", text: `${text} — ${casa}` });
    push(h.lotContractDate, "Lote em contrato (EMD)");
    push(h.lotPaidDate, `Lote comprado${n(h.actualLotCost) > 0 ? ` por ${money(n(h.actualLotCost), cur)}` : ""}`);
    push(h.permitAppliedDate, "Permit aplicado");
    push(h.permitIssuedDate, "Permit emitido");
    push(h.buildStartDate, "Obra iniciada");
    push(h.coDate, "CO emitido — obra 100%");
    push(h.listedDate, "Anunciada no mercado");
    push(h.contractDate, "Sob contrato de venda");
    push(h.saleDate, `Vendida${n(h.soldPrice) > 0 ? ` por ${money(n(h.soldPrice), cur)}` : ""}`);
  }

  for (const d of input.distributions)
    ev.push({ date: d.date, icon: "📤", tone: "dist", text: `Distribuição aos investidores — ${money(n(d.amount), cur)}` });

  for (const e of input.expenses.filter((x) => x.status === "PAID"))
    ev.push({ date: e.date, icon: "🧾", tone: "expense", text: `Despesa paga — ${e.description} (${money(n(e.amount), cur)})` });

  ev.sort((a, b) => b.date.getTime() - a.date.getTime());
  return { events: ev.slice(0, limit), total: ev.length };
}
