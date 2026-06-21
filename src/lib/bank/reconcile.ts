import type { PrismaClient } from "@prisma/client";

const DAY = 86_400_000;

interface Txn {
  id: string;
  date: number; // ms
  amount: number; // cents-rounded
}

// Encontra um subconjunto (2..maxSize) de lançamentos não usados, dentro da janela e do mesmo
// sinal, que SOMA ao valor da linha do banco (split: 1 linha do banco = N lançamentos no GL).
function findSplit(
  target: number,
  lineDate: number,
  windowMs: number,
  pool: Txn[],
  used: Set<string>,
  maxSize = 3,
): Txn[] | null {
  const cands = pool
    .filter(
      (t) =>
        !used.has(t.id) &&
        Math.sign(t.amount) === Math.sign(target) &&
        Math.abs(t.date - lineDate) <= windowMs &&
        Math.abs(t.amount) <= Math.abs(target) + 0.01,
    )
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 30);
  const eq = (a: number, b: number) => Math.abs(a - b) < 0.01;

  for (let i = 0; i < cands.length; i++) {
    for (let j = i + 1; j < cands.length; j++) {
      if (eq(cands[i].amount + cands[j].amount, target)) return [cands[i], cands[j]];
      if (maxSize >= 3) {
        for (let k = j + 1; k < cands.length; k++) {
          if (eq(cands[i].amount + cands[j].amount + cands[k].amount, target))
            return [cands[i], cands[j], cands[k]];
        }
      }
    }
  }
  return null;
}

/**
 * Casa automaticamente as linhas AINDA não revisadas do extrato contra o razão, em passes:
 *  1) valor exato + data dentro da janela curta (5 dias);
 *  2) valor exato + janela larga (45 dias) — pega lançamento postado em data diferente (ex.: JE);
 *  3) SPLIT — soma de 2-3 lançamentos = a linha do banco (uma transferência/depósito dividido).
 * Respeita decisões manuais (status != UNREVIEWED). Idempotente.
 */
export async function reconcileStatement(
  prisma: PrismaClient,
  statementId: string,
  windowDays = 5,
): Promise<void> {
  const st = await prisma.bankStatement.findUnique({
    where: { id: statementId },
    include: { lines: true },
  });
  if (!st) return;

  // Escopa à conta-caixa do GL quando o extrato está mapeado (GL ≠ extrato).
  const glRaw = await prisma.ledgerTxn.findMany({
    where: { companyId: st.companyId, ...(st.glAccount ? { account: st.glAccount } : {}) },
    select: { id: true, date: true, amount: true },
  });
  const pool: Txn[] = glRaw.map((t) => ({
    id: t.id,
    date: t.date.getTime(),
    amount: Math.round(Number(t.amount.toString()) * 100) / 100,
  }));
  const byAmount = new Map<string, Txn[]>();
  for (const t of pool) (byAmount.get(t.amount.toFixed(2)) ?? byAmount.set(t.amount.toFixed(2), []).get(t.amount.toFixed(2))!).push(t);

  const used = new Set<string>();
  for (const l of st.lines) if (l.matchedTxnId) used.add(l.matchedTxnId);

  const open = st.lines
    .filter((l) => l.status === "UNREVIEWED")
    .map((l) => ({ id: l.id, date: l.date.getTime(), amount: Math.round(Number(l.amount.toString()) * 100) / 100 }));

  const mark = (lineId: string, txnIds: string[], note: string | null) =>
    prisma.bankStatementLine.update({
      where: { id: lineId },
      data: { matchedTxnId: txnIds[0], matchedTxnIds: txnIds, status: "MATCHED", matchNote: note },
    });

  // Passe 1 e 2 — match exato único (janela curta, depois larga).
  for (const windowMs of [windowDays * DAY, 45 * DAY]) {
    for (const l of open) {
      if (used.has("line:" + l.id)) continue; // já casada num passe anterior
      const hit = (byAmount.get(l.amount.toFixed(2)) ?? []).find(
        (c) => !used.has(c.id) && Math.abs(c.date - l.date) <= windowMs,
      );
      if (hit) {
        used.add(hit.id);
        used.add("line:" + l.id);
        await mark(l.id, [hit.id], null);
      }
    }
  }

  // Passe 3 — split (soma de 2-3 lançamentos), janela de 10 dias.
  for (const l of open) {
    if (used.has("line:" + l.id)) continue;
    const set = findSplit(l.amount, l.date, 10 * DAY, pool, used);
    if (set) {
      for (const t of set) used.add(t.id);
      used.add("line:" + l.id);
      await mark(l.id, set.map((t) => t.id), `split — ${set.length} entries`);
    }
  }
}
