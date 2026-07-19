// Audit log do módulo Investments (#65) — helper único que registra QUEM fez a ação
// sensível. Best-effort: nunca deixa a auditoria derrubar a operação principal (try/catch).
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

export type AuditEntity =
  | "MEMBER"
  | "CONTRIBUTION"
  | "TRANSFER"
  | "DISTRIBUTION"
  | "CAPITAL_CALL"
  | "SUBSCRIPTION"
  | "REPORT"
  | "HOUSE"
  | "POOL";

export type AuditAction = "CREATE" | "UPDATE" | "DELETE" | "PUBLISH" | "ACCEPT" | "REJECT" | "PAYMENT";

export async function logInvestmentAudit(input: {
  poolId?: string | null;
  entity: AuditEntity;
  entityId?: string | null;
  action: AuditAction;
  summary: string;
  meta?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const session = await auth();
    await prisma.investmentAudit.create({
      data: {
        poolId: input.poolId ?? null,
        entity: input.entity,
        entityId: input.entityId ?? null,
        action: input.action,
        summary: input.summary,
        changedBy: session?.user?.email ?? "unknown",
        meta: (input.meta ?? undefined) as object | undefined,
      },
    });
  } catch {
    // auditoria é best-effort — não propaga erro para a ação principal
  }
}
