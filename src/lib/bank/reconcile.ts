import type { PrismaClient } from "@prisma/client";

const DAY = 86_400_000;

/**
 * Casa automaticamente as linhas AINDA não revisadas do extrato contra o razão
 * (por valor exato + data dentro da janela). Respeita decisões manuais (status != UNREVIEWED).
 * Persiste matchedTxnId + status MATCHED. Idempotente.
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

  const gl = await prisma.ledgerTxn.findMany({
    where: { companyId: st.companyId },
    select: { id: true, date: true, amount: true },
  });
  const byAmount = new Map<string, { id: string; date: Date }[]>();
  for (const t of gl) {
    const k = Number(t.amount.toString()).toFixed(2);
    (byAmount.get(k) ?? byAmount.set(k, []).get(k)!).push({ id: t.id, date: t.date });
  }

  const used = new Set<string>();
  for (const l of st.lines) if (l.matchedTxnId) used.add(l.matchedTxnId);

  for (const l of st.lines) {
    if (l.status !== "UNREVIEWED") continue;
    const k = Number(l.amount.toString()).toFixed(2);
    const hit = (byAmount.get(k) ?? []).find(
      (c) => !used.has(c.id) && Math.abs(c.date.getTime() - l.date.getTime()) <= windowDays * DAY,
    );
    if (hit) {
      used.add(hit.id);
      await prisma.bankStatementLine.update({
        where: { id: l.id },
        data: { matchedTxnId: hit.id, status: "MATCHED" },
      });
    }
  }
}
