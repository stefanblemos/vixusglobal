import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.findFirst({ where: { legalName: "L2 Legacy Group" } });
  if (!company) throw new Error("no company");
  const imp = await prisma.qboImport.findFirst({
    where: { companyId: company.id, reportKind: "BALANCE_SHEET" },
    orderBy: { createdAt: "desc" },
  });
  if (!imp) throw new Error("no BS import");
  console.log("Import:", imp.reportTypeLabel, imp.periodLabel);
  const lines = await prisma.qboImportLine.findMany({
    where: { importId: imp.id, lineType: "TOTAL" },
    orderBy: { rowIndex: "asc" },
  });
  for (const l of lines) {
    console.log(
      `depth=${l.depth}  [${l.sectionPath.join(" > ")}]  "${l.label}" = ${l.value?.toString() ?? "—"}`,
    );
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
