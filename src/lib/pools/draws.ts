// Ciclo de vida e numeração de draw. Status: REQUESTED (pendente) → APPROVED | DENIED |
// CANCELLED. Numeração sequencial por loan (Draw #1, #2…). Negado/cancelado fica na
// trilha (amount 0) mas não afeta saldo.
import { prisma } from "@/lib/db";

export type DrawStatus = "REQUESTED" | "APPROVED" | "DENIED" | "CANCELLED";

export const DRAW_STATUS_LABEL: Record<DrawStatus, string> = {
  REQUESTED: "Solicitado",
  APPROVED: "Aprovado",
  DENIED: "Negado",
  CANCELLED: "Cancelado",
};

// status efetivo de um lançamento de draw (deriva do legado quando drawStatus é null)
export function effectiveDrawStatus(e: { drawStatus?: string | null; pending: boolean }): DrawStatus {
  if (e.drawStatus) return e.drawStatus as DrawStatus;
  return e.pending ? "REQUESTED" : "APPROVED";
}

// Loan só libera draws depois de FECHAR (closingDate). Antes disso está em LOI/documentação:
// a obra pode andar com equity, mas o banco não credita nem aceita solicitação de draw. FONTE
// ÚNICA — draws page, risk, aba do loan e a ação addDraw usam isto em vez de recomputar
// `!closingDate` cada um por conta (era a origem do scatter: a mesma casa "pode" numa tela e
// "não pode" noutra). Não considera quitação — o chamador combina com `paidOff` p/ o rótulo.
export function loanAwaitingClosing(loan: { closingDate: Date | string | null }): boolean {
  return loan.closingDate == null;
}

// próximo número de draw do loan (max + 1)
export async function nextDrawNumber(loanId: string): Promise<number> {
  const max = await prisma.poolLoanEntry.aggregate({
    where: { loanId, type: "DRAW" },
    _max: { drawNumber: true },
  });
  return (max._max.drawNumber ?? 0) + 1;
}

// Número do draw por LEVA: um pedido em conjunto (várias casas no MESMO DIA, no mesmo loan)
// compartilha o número — o Draw #N é o N-ésimo pedido ao banco, não N-ésima casa. Se já existe
// um draw do loan na mesma data de solicitação, reusa o número dele; senão, próximo. Per-loan
// (bancos independentes têm sequências próprias). FONTE ÚNICA — addDraw/requestHouseDraw/
// requestBatchDraw usam isto em vez de nextDrawNumber, que numerava por casa (o scatter).
export async function drawNumberForBatch(loanId: string, batchDate: Date): Promise<number> {
  const start = new Date(Date.UTC(batchDate.getUTCFullYear(), batchDate.getUTCMonth(), batchDate.getUTCDate()));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const sameDay = await prisma.poolLoanEntry.findFirst({
    where: { loanId, type: "DRAW", requestDate: { gte: start, lt: end }, drawNumber: { not: null } },
    orderBy: { drawNumber: "asc" },
    select: { drawNumber: true },
  });
  if (sameDay?.drawNumber != null) return sameDay.drawNumber;
  return nextDrawNumber(loanId);
}
