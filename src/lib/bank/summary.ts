import type { PrismaClient } from "@prisma/client";

const iso = (d: Date) => d.toISOString().slice(0, 10);

export interface ReverseException {
  id: string;
  date: string;
  type: string;
  name: string | null;
  split: string | null;
  amount: string;
}

export interface BankReconSummary {
  glAccounts: string[]; // contas distintas do GL da empresa (para mapear)
  mappedAccount: string | null;
  hasGl: boolean; // a empresa tem GL importado?
  bankNet: number; // soma das linhas do extrato no período
  glNet: number; // soma da conta-caixa no GL no mesmo período
  difference: number; // bankNet - glNet (≈0 = período fecha)
  bookedNotOnStatement: ReverseException[]; // GL caixa sem linha do extrato casada
}

/**
 * Resumo de conciliação de um extrato contra a conta-caixa do GL: movimento líquido
 * dos dois lados (tem que bater) e o lado reverso — lançamentos do razão na conta-caixa
 * que não aparecem no extrato ("nos livros, não no banco"). Só calcula o lado GL quando
 * o extrato está mapeado a uma conta (glAccount).
 */
export async function buildBankReconSummary(
  prisma: PrismaClient,
  statementId: string,
): Promise<BankReconSummary | null> {
  const st = await prisma.bankStatement.findUnique({
    where: { id: statementId },
    include: { lines: true },
  });
  if (!st) return null;

  const distinct = await prisma.ledgerTxn.findMany({
    where: { companyId: st.companyId },
    distinct: ["account"],
    select: { account: true },
    orderBy: { account: "asc" },
  });
  const glAccounts = distinct.map((r) => r.account);

  const bankNet = st.lines.reduce((s, l) => s + Number(l.amount.toString()), 0);

  let glNet = 0;
  let bookedNotOnStatement: ReverseException[] = [];

  if (st.glAccount) {
    const dateRange =
      st.periodStart || st.periodEnd
        ? {
            date: {
              ...(st.periodStart ? { gte: st.periodStart } : {}),
              ...(st.periodEnd ? { lte: st.periodEnd } : {}),
            },
          }
        : {};
    const cashTxns = await prisma.ledgerTxn.findMany({
      where: { companyId: st.companyId, account: st.glAccount, ...dateRange },
      include: { vendor: true },
      orderBy: { date: "asc" },
    });
    glNet = cashTxns.reduce((s, t) => s + Number(t.amount.toString()), 0);

    // Considera TODOS os lançamentos casados — inclusive os componentes de um split.
    const matched = new Set<string>();
    for (const l of st.lines) {
      if (l.matchedTxnId) matched.add(l.matchedTxnId);
      for (const id of l.matchedTxnIds) matched.add(id);
    }
    bookedNotOnStatement = cashTxns
      .filter((t) => !matched.has(t.id))
      .map((t) => ({
        id: t.id,
        date: iso(t.date),
        type: t.type,
        name: t.vendor?.name ?? t.rawName ?? null,
        split: t.split,
        amount: t.amount.toString(),
      }));
  }

  return {
    glAccounts,
    mappedAccount: st.glAccount,
    hasGl: glAccounts.length > 0,
    bankNet,
    glNet,
    difference: bankNet - glNet,
    bookedNotOnStatement,
  };
}
