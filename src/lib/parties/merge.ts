import { prisma } from "@/lib/db";

// Mescla um dono duplicado (drop) no canônico (keep): move participações, declarações,
// vendores do razão e SSN; guarda o nome divergente como alias; apaga o duplicado.
// Núcleo reutilizável (testável) usado pela server action mergeParties.
export async function mergePartyById(keepId: string, dropId: string): Promise<void> {
  if (!keepId || !dropId || keepId === dropId) return;

  const [keep, drop] = await Promise.all([
    prisma.party.findUnique({
      where: { id: keepId },
      select: { id: true, name: true, taxId: true, aliases: true },
    }),
    prisma.party.findUnique({
      where: { id: dropId },
      select: { id: true, name: true, taxId: true, aliases: true },
    }),
  ]);
  if (!keep || !drop) return;

  // Participações onde o duplicado é DONO → reaponta para o canônico (sem duplicar a mesma
  // empresa: se o canônico já tem aquela participação, descarta a do duplicado).
  const keepOwns = await prisma.ownership.findMany({
    where: { ownerPartyId: keepId },
    select: { ownedCompanyId: true, ownedPartyId: true },
  });
  const owned = new Set(keepOwns.map((o) => `${o.ownedCompanyId ?? ""}|${o.ownedPartyId ?? ""}`));
  const dropOwns = await prisma.ownership.findMany({
    where: { ownerPartyId: dropId },
    select: { id: true, ownedCompanyId: true, ownedPartyId: true },
  });
  for (const o of dropOwns) {
    const k = `${o.ownedCompanyId ?? ""}|${o.ownedPartyId ?? ""}`;
    if (owned.has(k)) await prisma.ownership.delete({ where: { id: o.id } });
    else await prisma.ownership.update({ where: { id: o.id }, data: { ownerPartyId: keepId } });
  }

  // Participações onde o duplicado é POSSUÍDO, declarações pessoais e vendors do GL → reaponta.
  await prisma.ownership.updateMany({ where: { ownedPartyId: dropId }, data: { ownedPartyId: keepId } });
  await prisma.personalReturn.updateMany({ where: { partyId: dropId }, data: { partyId: keepId } });
  await prisma.vendor.updateMany({ where: { matchedPartyId: dropId }, data: { matchedPartyId: keepId } });

  // Guarda o nome (e aliases) do duplicado como ALIAS do canônico — assim imports futuros com
  // o nome divergente casam direto e não recriam a duplicata. Preenche o SSN se faltava.
  const aliases = [...new Set([...keep.aliases, drop.name, ...drop.aliases])].filter(
    (a) => a && a !== keep.name,
  );
  await prisma.party.update({
    where: { id: keepId },
    data: { aliases, ...(!keep.taxId && drop.taxId ? { taxId: drop.taxId } : {}) },
  });

  await prisma.party.delete({ where: { id: dropId } });
}
