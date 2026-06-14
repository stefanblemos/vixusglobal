import { PrismaClient, CompanyRelationship } from "@prisma/client";

const prisma = new PrismaClient();

// Entidades referenciadas nos QBO. Defaults: US / LLC.
// Vixus = holding (GROUP_MEMBER); demais = MANAGED_ONLY (rever depois).
const ENTITIES: {
  legalName: string;
  aliases?: string[];
  relationship: CompanyRelationship;
}[] = [
  {
    legalName: "Vixus Global Investments",
    aliases: [
      "VixUS Investment Partners LLC",
      "Vixus Investment Partners LLC",
      "Vixus Partners Investment LLC",
      "Vixus Invetment Partners LLC",
    ],
    relationship: "GROUP_MEMBER",
  },
  { legalName: "Avantec Design & Engineering Solutions LLC", relationship: "MANAGED_ONLY" },
  { legalName: "Truss Direct LLC", aliases: ["Truss Direct, LLC"], relationship: "MANAGED_ONLY" },
  { legalName: "Nexspace Properties LLC", relationship: "MANAGED_ONLY" },
  { legalName: "Bonomo Investments LLC", relationship: "MANAGED_ONLY" },
  { legalName: "14528 Braddock Oaks LLC", relationship: "MANAGED_ONLY" },
  { legalName: "Rezini & Dias Investments LLC", relationship: "MANAGED_ONLY" },
];

async function main() {
  for (const e of ENTITIES) {
    const existing = await prisma.company.findFirst({
      where: {
        OR: [{ legalName: e.legalName }, { aliases: { hasSome: e.aliases ?? [] } }],
      },
    });
    if (existing) {
      console.log(`exists: ${e.legalName}`);
      continue;
    }
    await prisma.company.create({
      data: {
        legalName: e.legalName,
        aliases: e.aliases ?? [],
        jurisdiction: "US",
        entityType: "LLC",
        relationship: e.relationship,
        baseCurrency: "USD",
        notes: "Created from QBO references — review jurisdiction/type/relationship.",
      },
    });
    console.log(`created: ${e.legalName} (${e.relationship})`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
