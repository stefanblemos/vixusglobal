import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function companyId(legalName: string): Promise<string> {
  const c = await prisma.company.findFirst({ where: { legalName } });
  if (!c) throw new Error(`company not found: ${legalName}`);
  return c.id;
}
async function partyId(name: string): Promise<string> {
  const p = await prisma.party.findFirst({ where: { name } });
  if (!p) throw new Error(`party not found: ${name}`);
  return p.id;
}

async function ensureCompany(legalName: string) {
  const found = await prisma.company.findFirst({ where: { legalName } });
  if (found) return found.id;
  const c = await prisma.company.create({
    data: {
      legalName,
      jurisdiction: "US",
      entityType: "LLC",
      relationship: "MANAGED_ONLY",
      baseCurrency: "USD",
      notes: "External partner — created for ownership link.",
    },
  });
  console.log(`created external entity: ${legalName}`);
  return c.id;
}

async function linkCompany(ownerLegal: string, ownedLegal: string, percentage: number) {
  const ownerCompanyId = await companyId(ownerLegal);
  const ownedCompanyId = await companyId(ownedLegal);
  const exists = await prisma.ownership.findFirst({ where: { ownerCompanyId, ownedCompanyId } });
  if (exists) return console.log(`exists: ${ownerLegal} → ${ownedLegal}`);
  await prisma.ownership.create({ data: { ownerCompanyId, ownedCompanyId, percentage } });
  console.log(`linked: ${ownerLegal} ${percentage}% → ${ownedLegal}`);
}

async function linkParty(ownerName: string, ownedLegal: string, percentage: number) {
  const ownerPartyId = await partyId(ownerName);
  const ownedCompanyId = await companyId(ownedLegal);
  const exists = await prisma.ownership.findFirst({ where: { ownerPartyId, ownedCompanyId } });
  if (exists) return console.log(`exists: ${ownerName} → ${ownedLegal}`);
  await prisma.ownership.create({ data: { ownerPartyId, ownedCompanyId, percentage } });
  console.log(`linked: ${ownerName} ${percentage}% → ${ownedLegal}`);
}

async function main() {
  // Holding e Truss = J Monteiro + L2 (50/50)
  for (const owned of ["Vixus Investment Partners LLC", "Truss Direct LLC"]) {
    await linkCompany("J Monteiro Investment LLC", owned, 50);
    await linkCompany("L2 Legacy Group", owned, 50);
  }

  // Braddock = Stefan + Fabiola (50/50)
  await linkParty("Stefan Braga Lemos", "14528 Braddock Oak Dr LLC", 50);
  await linkParty("Fabiola Miranda Lima Lemos", "14528 Braddock Oak Dr LLC", 50);

  // AGE = Gabriella + Vera (50/50)
  await linkParty("Gabriella Dalla Bernardina Ribeiro", "AGE Investment Group LLC", 50);
  await linkParty("Vera Lucia Dalla Bernardina Ribeiro", "AGE Investment Group LLC", 50);

  // Vision7 = SALL LLC 62,5% + Vixus America 37,5%
  await ensureCompany("SALL LLC");
  await linkCompany("SALL LLC", "Vision7 Development LLC", 62.5);
  await linkCompany("Vixus America Investments", "Vision7 Development LLC", 37.5);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
