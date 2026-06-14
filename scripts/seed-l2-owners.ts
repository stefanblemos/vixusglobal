import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Donos da L2 Legacy Group: Stefan Braga Lemos e Fabiola Miranda Lima Lemos, 50/50.
async function upsertParty(name: string) {
  const found = await prisma.party.findFirst({ where: { name } });
  return found ?? prisma.party.create({ data: { name, kind: "PERSON", taxJurisdiction: "US" } });
}

async function link(ownerPartyId: string, ownedCompanyId: string, percentage: number) {
  const found = await prisma.ownership.findFirst({ where: { ownerPartyId, ownedCompanyId } });
  if (!found) await prisma.ownership.create({ data: { ownerPartyId, ownedCompanyId, percentage } });
}

async function main() {
  const l2 = await prisma.company.findFirst({ where: { legalName: "L2 Legacy Group" } });
  if (!l2) throw new Error("L2 Legacy Group not found");

  const stefan = await upsertParty("Stefan Braga Lemos");
  const fabiola = await upsertParty("Fabiola Miranda Lima Lemos");
  await link(stefan.id, l2.id, 50);
  await link(fabiola.id, l2.id, 50);

  console.log("L2 owners set: Stefan 50% + Fabiola 50%");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
