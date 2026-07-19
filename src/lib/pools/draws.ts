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

// próximo número de draw do loan (max + 1)
export async function nextDrawNumber(loanId: string): Promise<number> {
  const max = await prisma.poolLoanEntry.aggregate({
    where: { loanId, type: "DRAW" },
    _max: { drawNumber: true },
  });
  return (max._max.drawNumber ?? 0) + 1;
}
