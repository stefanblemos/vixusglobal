"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { EntityType, Jurisdiction } from "@prisma/client";
import { prisma } from "@/lib/db";
import { rebuildOwnershipFromIRs } from "@/lib/ir/rebuild-ownership";
import { ALL_ENTITY_TYPE_VALUES } from "@/lib/catalog";

const einDigits = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "");

// Registra uma empresa NOVA a partir de um IR que não casou com o cadastro (EIN inédito).
// Liga todos os IRs órfãos da mesma entidade (mesmo EIN, senão mesmo nome) e leva para a
// página da empresa recém-criada.
export async function registerCompanyFromReturn(formData: FormData): Promise<void> {
  const returnId = String(formData.get("returnId") ?? "");
  if (!returnId) return;
  const r = await prisma.taxReturn.findUnique({ where: { id: returnId } });
  if (!r || r.companyId) return; // já casado ou inexistente
  const name = (r.matchedName ?? "").trim();
  if (!name) return;

  const jur: Jurisdiction = (["US", "BR", "PT", "OTHER"] as const).includes(
    r.jurisdiction as Jurisdiction,
  )
    ? (r.jurisdiction as Jurisdiction)
    : Jurisdiction.US;
  const entityType: EntityType = ALL_ENTITY_TYPE_VALUES.includes(r.entityType ?? "")
    ? (r.entityType as EntityType)
    : jur === Jurisdiction.BR
      ? EntityType.LTDA
      : EntityType.LLC;

  const company = await prisma.company.create({
    data: {
      legalName: name,
      jurisdiction: jur,
      state: r.state ?? null,
      entityType,
      taxId: r.taxId ?? null,
      formationDate: r.incorporationDate ?? null,
      relationship: "GROUP_MEMBER",
      status: "ACTIVE",
    },
  });

  // Liga todos os IRs órfãos da mesma entidade.
  const ein = einDigits(r.taxId);
  const orphans = await prisma.taxReturn.findMany({
    where: { companyId: null },
    select: { id: true, taxId: true, matchedName: true },
  });
  const linkIds = orphans
    .filter((o) =>
      ein
        ? einDigits(o.taxId) === ein
        : (o.matchedName ?? "").trim().toLowerCase() === name.toLowerCase(),
    )
    .map((o) => o.id);
  if (linkIds.length > 0) {
    await prisma.taxReturn.updateMany({
      where: { id: { in: linkIds } },
      data: { companyId: company.id },
    });
  }

  try {
    await rebuildOwnershipFromIRs(company.id);
  } catch {
    /* não-fatal */
  }

  revalidatePath("/tax");
  revalidatePath("/companies");
  redirect(`/companies/${company.id}`);
}
