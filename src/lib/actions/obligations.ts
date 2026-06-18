"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";

// Marca uma instância de obrigação (empresa + chave + período) como feita / não-se-aplica /
// pendente. Pendente = remover a linha (ausência = pendente).
export async function setObligationStatus(input: {
  companyId: string;
  key: string;
  periodKey: string;
  status: "PENDING" | "FILED" | "NA";
}): Promise<void> {
  const { companyId, key, periodKey, status } = input;

  if (status === "PENDING") {
    await prisma.obligationStatus
      .delete({ where: { companyId_key_periodKey: { companyId, key, periodKey } } })
      .catch(() => {});
  } else {
    await prisma.obligationStatus.upsert({
      where: { companyId_key_periodKey: { companyId, key, periodKey } },
      update: { status, filedDate: status === "FILED" ? new Date() : null },
      create: {
        companyId,
        key,
        periodKey,
        status,
        filedDate: status === "FILED" ? new Date() : null,
      },
    });
  }
  revalidatePath("/obligations");
}
