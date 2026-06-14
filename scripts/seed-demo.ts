import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Dados confirmados (ver memória): J Monteiro Investment LLC tem como donos
// Patrick e Vanessa Geaquinto (~50/50, conforme Owner's Investment no QBO).
async function upsertParty(name: string) {
  const found = await prisma.party.findFirst({ where: { name } });
  if (found) return found;
  return prisma.party.create({
    data: { name, kind: "PERSON", taxJurisdiction: "US" },
  });
}

async function upsertCompany(legalName: string) {
  const found = await prisma.company.findFirst({ where: { legalName } });
  if (found) return found;
  return prisma.company.create({
    data: {
      legalName,
      jurisdiction: "US",
      state: "FL",
      entityType: "LLC",
      relationship: "MANAGED_ONLY",
      baseCurrency: "USD",
    },
  });
}

async function linkOwner(ownerPartyId: string, ownedCompanyId: string, percentage: number) {
  const found = await prisma.ownership.findFirst({ where: { ownerPartyId, ownedCompanyId } });
  if (found) return;
  await prisma.ownership.create({ data: { ownerPartyId, ownedCompanyId, percentage } });
}

async function main() {
  const patrick = await upsertParty("Patrick Geaquinto");
  const vanessa = await upsertParty("Vanessa Geaquinto");
  const jm = await upsertCompany("J Monteiro Investment LLC");
  await linkOwner(patrick.id, jm.id, 50);
  await linkOwner(vanessa.id, jm.id, 50);
  console.log(`Demo ok — J Monteiro id=${jm.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
