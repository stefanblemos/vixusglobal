import { prisma } from "../src/lib/db";

async function main() {
  const locs = await prisma.catalogLocation.findMany({
    select: { name: true, lotLeadDays: true, permitDays: true, saleDays: true },
  });
  const scs = await prisma.bufferScenario.findMany({
    select: { code: true, landAcquisitionDays: true },
    orderBy: { sortOrder: "asc" },
  });
  console.log("LOCATIONS:");
  for (const l of locs) console.log(`  ${l.name}: lotLead ${l.lotLeadDays}d · permit ${l.permitDays}d · sale ${l.saleDays}d`);
  console.log("SCENARIOS:");
  for (const s of scs) console.log(`  ${s.code}: landAcquisition ${s.landAcquisitionDays}d`);
}

main().finally(() => prisma.$disconnect());
