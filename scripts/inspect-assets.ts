import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  for (const legalName of [
    "L2 Legacy Group",
    "14528 Braddock Oak Dr LLC",
    "4U Custom Homes Corp",
  ]) {
    const c = await prisma.company.findFirst({ where: { legalName } });
    if (!c) continue;
    console.log(`\n===== ${legalName} =====`);

    const bs = await prisma.qboImport.findFirst({
      where: { companyId: c.id, reportKind: "BALANCE_SHEET" },
      orderBy: { createdAt: "desc" },
    });
    if (bs) {
      const lines = await prisma.qboImportLine.findMany({ where: { importId: bs.id } });
      const fixed = lines.filter((l) => l.sectionPath.some((s) => /fixed asset/i.test(s)));
      console.log(`-- Fixed Assets lines (${fixed.length}) --`);
      for (const l of fixed) {
        console.log(
          `  ${l.lineType} d=${l.depth} [${l.sectionPath.join(">")}] "${l.label}" = ${l.value?.toString() ?? "—"}`,
        );
      }
      const dep = lines.filter((l) => /depreciat/i.test(l.label));
      console.log(`-- Depreciation lines in BS (${dep.length}) --`);
      for (const l of dep)
        console.log(`  ${l.lineType} "${l.label}" = ${l.value?.toString() ?? "—"}`);
    } else {
      console.log("(no BS import)");
    }

    // Depreciação no GL
    const glDep = await prisma.ledgerTxn.groupBy({
      by: ["account"],
      where: { companyId: c.id, account: { contains: "epreciat" } },
      _sum: { amount: true },
      _count: true,
    });
    console.log(`-- GL depreciation accounts (${glDep.length}) --`);
    for (const g of glDep)
      console.log(`  "${g.account}" sum=${g._sum.amount?.toString() ?? "0"} (${g._count} txns)`);
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
