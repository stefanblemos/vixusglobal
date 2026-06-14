import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Lança a L2 Legacy Group (antiga "L&L International Investments LLC").
async function main() {
  const legalName = "L2 Legacy Group";
  const aliases = ["L&L International Investment LLC", "L&L International Investments LLC"];

  const existing = await prisma.company.findFirst({
    where: { OR: [{ legalName }, { aliases: { hasSome: aliases } }] },
  });

  const company = existing
    ? await prisma.company.update({ where: { id: existing.id }, data: { legalName, aliases } })
    : await prisma.company.create({
        data: {
          legalName,
          aliases,
          jurisdiction: "US",
          entityType: "LLC",
          relationship: "GROUP_MEMBER",
          baseCurrency: "USD",
          notes: "Formerly L&L International Investments LLC. Co-owner of the Vixus holding.",
        },
      });

  console.log(`L2 Legacy Group ${existing ? "updated" : "created"} — id=${company.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
