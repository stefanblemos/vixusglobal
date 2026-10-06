import { prisma } from "@/lib/db";

/**
 * Conferência do pool com o GL do QuickBooks (etapa 3, 05/10/2026).
 *
 * O pool (ex.: PH-3) pode não ter LLC própria — os livros vivem na empresa dona (Vixus
 * America). Então a conferência é por RECORTE do GL da entidade do pool:
 *  - por CASA: transações cuja descrição/nome cita o endereço (número + rua) e que ainda não
 *    estão no extrato da casa (sem glTxnId e sem par por valor) → sugestão "trazer p/ o extrato";
 *  - pelo LOAN: transações na conta que cita o número do loan — comparadas com a aba Banco.
 */

export type GlSuggestion = {
  txnId: string;
  date: string;
  account: string;
  name: string | null;
  description: string | null;
  amount: number;
  category: string; // sugerida pelo nome da conta
  matchesOpening: boolean; // mesmo valor de uma abertura da casa → vai só datar a abertura
  // lançamentos existentes da casa que este GL pode COMPROVAR (reconciliar: data/origem passam p/ ele,
  // valor do lançamento fica) — padrão quando existe abertura da mesma categoria
  candidates: Array<{ id: string; label: string; amount: number; opening: boolean; sameAmount: boolean }>;
  suggestedEntryId: string | null;
};

export type HouseGlReport = {
  houseId: string;
  address: string;
  suggestions: GlSuggestion[];
  alreadyLinked: number;
};

export type LoanGlReport = {
  loanNumber: string;
  glCount: number;
  glTotal: number;
  bankCount: number;
  bankTotal: number; // soma dos lançamentos POSITIVOS da aba Banco (fees, reserve, draws)
};

const r2 = (v: number) => Math.round(v * 100) / 100;

export function categoryForAccount(account: string): string {
  const a = account.toLowerCase();
  if (/lot|land|terreno/.test(a)) return "LOT";
  if (/contractor|capitalized|construction|obra|build/.test(a)) return "BUILD";
  if (/closing/.test(a)) return "CASH_TO_CLOSE";
  if (/interest|juros/.test(a)) return "INTEREST";
  if (/fee|bank|charge/.test(a)) return "BANK_FEE";
  if (/insurance|tax|utilit|hoa|seguro/.test(a)) return "CARRYING";
  return "OTHER";
}

// "21021 Peachland Blvd" → termos p/ ILIKE: número e primeira palavra da rua
function addressTerms(address: string): string[] {
  const parts = address.trim().split(/\s+/);
  const num = parts[0];
  const street = parts.slice(1).find((p) => !/^(SW|SE|NW|NE|N|S|E|W)$/i.test(p)) ?? parts[1];
  if (!num || !street) return [];
  return [num, street];
}

export async function glReportForPool(args: {
  companyId: string | null;
  houses: Array<{ id: string; address: string; cashEntries: Array<{ id: string; amount: unknown; opening: boolean; glTxnId: string | null; kind: string; category: string; date: Date }> }>;
  loans: Array<{ loanNumber: string | null; entries: Array<{ amount: unknown; pending: boolean }> }>;
}): Promise<{ houses: HouseGlReport[]; loans: LoanGlReport[]; hasGl: boolean; glCount: number }> {
  if (!args.companyId) return { houses: [], loans: [], hasGl: false, glCount: 0 };
  const glCount = await prisma.ledgerTxn.count({ where: { companyId: args.companyId } });
  if (glCount === 0) return { houses: [], loans: [], hasGl: false, glCount: 0 };

  const houses: HouseGlReport[] = [];
  for (const h of args.houses) {
    const [num, street] = addressTerms(h.address);
    if (!num) continue;
    const txns = await prisma.ledgerTxn.findMany({
      where: {
        companyId: args.companyId,
        OR: [
          { description: { contains: num }, AND: { description: { contains: street, mode: "insensitive" } } },
          { rawName: { contains: num }, AND: { rawName: { contains: street, mode: "insensitive" } } },
        ],
        // só lado do custo (positivo); o par da partida dobrada (A/P, banco) não interessa
        amount: { gt: 0 },
        NOT: { account: { contains: "Accounts Payable" } },
      },
      orderBy: { date: "asc" },
    });
    const linked = new Set(h.cashEntries.map((e) => e.glTxnId).filter(Boolean));
    const amounts = h.cashEntries.filter((e) => e.kind === "COST" && !e.glTxnId).map((e) => ({ v: Number(e.amount), opening: e.opening }));
    const loanNumbers = args.loans.map((l) => l.loanNumber).filter((x): x is string => !!x);
    const suggestions: GlSuggestion[] = [];
    for (const t of txns) {
      if (linked.has(t.id)) continue;
      // só CUSTO da casa pago pelo pool: fora conta-banco (lado do caixa), conta do loan (já
      // está na aba Banco), conta-estoque com o nome da casa e lançamentos da VENDA (entram
      // pelo líquido recebido, não como custo)
      const acc = t.account.toLowerCase();
      if (/business adv|checking|savings|\bbank\b|cash/.test(acc)) continue;
      if (loanNumbers.some((ln) => acc.includes(ln.toLowerCase()))) continue;
      if (acc.includes(num) && acc.includes(street.toLowerCase())) continue;
      if (/\bsale\b|\bsold\b|credit of sale|venda/i.test(`${t.description ?? ""} ${t.rawName ?? ""}`)) continue;
      // já vive na aba Banco (statement do loan) e está embutido no payoff/líquido da venda —
      // trazer p/ a casa contaria duas vezes
      if (/reconveyance|inspection fee|draw fee|draw processing|ach fee|\binterest\b|budget review|origination|processing fee/i.test(`${t.description ?? ""} ${t.rawName ?? ""} ${t.account}`)) continue;
      const v = Number(t.amount);
      // já existe lançamento DATADO com o mesmo valor → considerado o mesmo fato, não sugere
      if (amounts.some((a) => !a.opening && Math.abs(a.v - v) < 0.01)) continue;
      const category = categoryForAccount(t.account);
      const CAT_LABEL: Record<string, string> = { LOT: "Lote", BUILD: "Obra", CASH_TO_CLOSE: "Cash to close", BANK_FEE: "Taxa do banco", INTEREST: "Juros", CARRYING: "Carregamento", OTHER: "Outro" };
      const candidates = h.cashEntries
        .filter((e) => e.kind === "COST" && !e.glTxnId)
        .map((e) => ({
          id: e.id,
          amount: r2(Number(e.amount)),
          opening: e.opening,
          sameAmount: Math.abs(Number(e.amount) - v) < 0.01,
          sameCategory: e.category === category,
          label: `${CAT_LABEL[e.category] ?? e.category} ${e.opening ? "(abertura)" : e.date.toISOString().slice(0, 10)} · $${r2(Number(e.amount)).toLocaleString("en-US", { minimumFractionDigits: 2 })}`,
        }))
        .sort((a, b) => Number(b.sameAmount) - Number(a.sameAmount) || Number(b.sameCategory) - Number(a.sameCategory));
      const exact = candidates.find((c) => c.sameAmount && c.sameCategory) ?? candidates.find((c) => c.sameAmount);
      const sameCat = candidates.filter((c) => c.sameCategory);
      suggestions.push({
        txnId: t.id,
        date: t.date.toISOString().slice(0, 10),
        account: t.account,
        name: t.rawName,
        description: t.description,
        amount: r2(v),
        category,
        matchesOpening: amounts.some((a) => a.opening && Math.abs(a.v - v) < 0.01),
        candidates: candidates.map(({ id, label, amount, opening, sameAmount }) => ({ id, label, amount, opening, sameAmount })),
        // padrão: par exato; senão a abertura da mesma categoria (o GL comprova data/origem do agregado)
        suggestedEntryId: exact?.id ?? sameCat.find((c) => c.opening)?.id ?? null,
      });
    }
    houses.push({ houseId: h.id, address: h.address, suggestions, alreadyLinked: linked.size });
  }

  const loans: LoanGlReport[] = [];
  for (const l of args.loans) {
    if (!l.loanNumber) continue;
    const agg = await prisma.ledgerTxn.aggregate({
      where: { companyId: args.companyId, account: { contains: l.loanNumber } },
      _count: true,
      _sum: { amount: true },
    });
    const bank = l.entries.filter((e) => !e.pending && Number(e.amount) > 0);
    loans.push({
      loanNumber: l.loanNumber,
      glCount: agg._count,
      glTotal: r2(Number(agg._sum.amount ?? 0)),
      bankCount: bank.length,
      bankTotal: r2(bank.reduce((s, e) => s + Number(e.amount), 0)),
    });
  }
  return { houses, loans, hasGl: true, glCount };
}
