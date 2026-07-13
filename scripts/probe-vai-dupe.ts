/**
 * Investiga a duplicidade Vixus America Investments × Vixus International Investments LLC:
 * o que cada registro tem pendurado, para decidir a fusão (qual é o canônico, o que migrar).
 */
import { prisma } from "../src/lib/db";

async function main() {
  const companies = await prisma.company.findMany({
    where: {
      OR: [
        { legalName: { contains: "America", mode: "insensitive" } },
        { legalName: { contains: "International", mode: "insensitive" } },
      ],
    },
    include: {
      _count: {
        select: {
          ownerStakes: true,
          ownedStakes: true,
          loansAsLender: true,
          loansAsBorrower: true,
          qboImports: true,
          ledgerTxns: true,
          bankStatements: true,
          taxStatuses: true,
          taxReturns: true,
          yearCloses: true,
          corporateDocs: true,
          yearNotes: true,
          obligationStatuses: true,
          fixedAssets: true,
          reserveDeposits: true,
          stateTaxFilings: true,
          poolsAsEntity: true,
          poolMemberships: true,
          disregardedChildren: true,
        },
      },
    },
  });
  for (const c of companies) {
    console.log(`\n=== ${c.legalName} (${c.id})`);
    console.log(
      `  tradeName: ${c.tradeName ?? "—"} · aliases: [${c.aliases.join(", ")}] · ${c.entityType} · ${c.jurisdiction}/${c.state ?? "—"} · EIN ${c.taxId ?? "—"} · formação ${c.formationDate ?? "—"} · status ${c.status} · criada ${c.createdAt.toISOString().slice(0, 10)}`,
    );
    if (c.disregardedIntoId) console.log(`  disregardedInto: ${c.disregardedIntoId}`);
    if (c.notes) console.log(`  notes: ${c.notes.slice(0, 120)}`);
    const counts = Object.entries(c._count).filter(([, v]) => v > 0);
    console.log(`  vínculos: ${counts.length ? counts.map(([k, v]) => `${k}=${v}`).join(" · ") : "NENHUM"}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
