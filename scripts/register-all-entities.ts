import { PrismaClient, CompanyRelationship, EntityType, Jurisdiction } from "@prisma/client";
import { matchCompany } from "../src/lib/qbo/match";

const prisma = new PrismaClient();

interface Target {
  legalName: string;
  aliases?: string[];
  jurisdiction: Jurisdiction;
  state?: string;
  entityType: EntityType;
  relationship: CompanyRelationship;
  baseCurrency: string;
}

// Mapa confirmado pelo usuário (2026-06-14).
const ENTITIES: Target[] = [
  {
    legalName: "Vixus Investment Partners LLC",
    aliases: [
      "Vixus Global Investments",
      "VixUS Global",
      "Vixus Global",
      "Vixus Partners Investment LLC",
      "Vixus Invetment Partners LLC",
    ],
    jurisdiction: "US",
    entityType: "LLC",
    relationship: "GROUP_MEMBER",
    baseCurrency: "USD",
  },
  {
    legalName: "Vixus America Investments",
    aliases: ["Vixus International Investments Corp", "Vixus International Investment LLC"],
    jurisdiction: "US",
    state: "FL",
    entityType: "C_CORP",
    relationship: "GROUP_MEMBER",
    baseCurrency: "USD",
  },
  {
    legalName: "Vixus Europa Investments",
    aliases: ["Hipérbole Vigilante Unipessoal Lda"],
    jurisdiction: "PT",
    entityType: "UNIPESSOAL_LDA",
    relationship: "GROUP_MEMBER",
    baseCurrency: "EUR",
  },
  {
    legalName: "Vitta Engenharia Ltda",
    aliases: ["Vitta Engenharia Ltda - Brasil"],
    jurisdiction: "BR",
    entityType: "LTDA",
    relationship: "MANAGED_ONLY",
    baseCurrency: "BRL",
  },
  {
    legalName: "Vision7 Development LLC",
    jurisdiction: "US",
    entityType: "LLC",
    relationship: "MANAGED_ONLY",
    baseCurrency: "USD",
  },
  {
    legalName: "Citrus Camburi LLC",
    jurisdiction: "US",
    entityType: "LLC",
    relationship: "MANAGED_ONLY",
    baseCurrency: "USD",
  },
  {
    legalName: "BuildPro Distributors LLC",
    jurisdiction: "US",
    entityType: "LLC",
    relationship: "MANAGED_ONLY",
    baseCurrency: "USD",
  },
  {
    legalName: "AGE Investment Group LLC",
    jurisdiction: "US",
    entityType: "LLC",
    relationship: "MANAGED_ONLY",
    baseCurrency: "USD",
  },
  {
    legalName: "4U Custom Homes Corp",
    jurisdiction: "US",
    entityType: "C_CORP",
    relationship: "MANAGED_ONLY",
    baseCurrency: "USD",
  },
  {
    legalName: "Fabiola Lemos, PA",
    jurisdiction: "US",
    entityType: "PA",
    relationship: "MANAGED_ONLY",
    baseCurrency: "USD",
  },
  {
    legalName: "Truss Direct LLC",
    aliases: ["Truss Direct, LLC"],
    jurisdiction: "US",
    entityType: "LLC",
    relationship: "MANAGED_ONLY",
    baseCurrency: "USD",
  },
  {
    legalName: "Nexspace Properties LLC",
    jurisdiction: "US",
    entityType: "LLC",
    relationship: "MANAGED_ONLY",
    baseCurrency: "USD",
  },
  {
    legalName: "Avantec Design & Engineering Solutions LLC",
    jurisdiction: "US",
    entityType: "LLC",
    relationship: "MANAGED_ONLY",
    baseCurrency: "USD",
  },
  {
    legalName: "14528 Braddock Oak Dr LLC",
    aliases: ["14528 Braddock Oaks LLC"],
    jurisdiction: "US",
    entityType: "LLC",
    relationship: "MANAGED_ONLY",
    baseCurrency: "USD",
  },
  {
    legalName: "Bonomo Investments LLC",
    jurisdiction: "US",
    entityType: "LLC",
    relationship: "MANAGED_ONLY",
    baseCurrency: "USD",
  },
  {
    legalName: "Rezini & Dias Investments LLC",
    jurisdiction: "US",
    entityType: "LLC",
    relationship: "MANAGED_ONLY",
    baseCurrency: "USD",
  },
];

async function main() {
  for (const t of ENTITIES) {
    const companies = await prisma.company.findMany({
      select: { id: true, legalName: true, tradeName: true, aliases: true },
    });
    const names = [t.legalName, ...(t.aliases ?? [])];
    let foundId: string | null = null;
    for (const n of names) {
      foundId = matchCompany(n, companies);
      if (foundId) break;
    }

    const data = {
      legalName: t.legalName,
      aliases: t.aliases ?? [],
      jurisdiction: t.jurisdiction,
      state: t.state ?? null,
      entityType: t.entityType,
      relationship: t.relationship,
      baseCurrency: t.baseCurrency,
    };

    if (foundId) {
      const existing = companies.find((c) => c.id === foundId)!;
      const mergedAliases = Array.from(new Set([...(t.aliases ?? []), ...existing.aliases]));
      await prisma.company.update({
        where: { id: foundId },
        data: { ...data, aliases: mergedAliases },
      });
      console.log(`updated: ${existing.legalName} -> ${t.legalName} (${t.baseCurrency})`);
    } else {
      await prisma.company.create({ data });
      console.log(`created: ${t.legalName} (${t.baseCurrency})`);
    }
  }

  // Novos donos (pessoas) revelados nos balanços.
  for (const name of [
    "Gabriella Dalla Bernardina Ribeiro",
    "Vera Lucia Dalla Bernardina Ribeiro",
  ]) {
    const exists = await prisma.party.findFirst({ where: { name } });
    if (!exists) {
      await prisma.party.create({ data: { name, kind: "PERSON", taxJurisdiction: "US" } });
      console.log(`party created: ${name}`);
    }
  }

  const total = await prisma.company.count();
  console.log(`\nTotal companies: ${total}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
