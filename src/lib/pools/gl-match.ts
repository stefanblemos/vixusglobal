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
  houses: Array<{ id: string; address: string; cashEntries: Array<{ amount: unknown; opening: boolean; glTxnId: string | null; kind: string }> }>;
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
      const v = Number(t.amount);
      // já existe lançamento DATADO com o mesmo valor → considerado o mesmo fato, não sugere
      if (amounts.some((a) => !a.opening && Math.abs(a.v - v) < 0.01)) continue;
      suggestions.push({
        txnId: t.id,
        date: t.date.toISOString().slice(0, 10),
        account: t.account,
        name: t.rawName,
        description: t.description,
        amount: r2(v),
        category: categoryForAccount(t.account),
        matchesOpening: amounts.some((a) => a.opening && Math.abs(a.v - v) < 0.01),
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
