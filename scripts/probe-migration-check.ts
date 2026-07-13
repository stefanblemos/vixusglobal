import { prisma } from "../src/lib/db";

async function main() {
  const cols = await prisma.$queryRaw<Array<{ table_name: string; column_name: string }>>`
    SELECT table_name, column_name FROM information_schema.columns
    WHERE (table_name = 'BufferScenario' AND column_name IN ('saleClosingDays', 'landAcquisitionDays'))
       OR (table_name = 'PoolSimulation' AND column_name = 'parallelPermit')`;
  console.log(JSON.stringify(cols));
  const scs = await prisma.$queryRaw<Array<{ code: string; landAcquisitionDays: number; saleClosingDays: number }>>`
    SELECT code, "landAcquisitionDays", "saleClosingDays" FROM "BufferScenario" ORDER BY "sortOrder"`;
  console.log(JSON.stringify(scs));
}

main().finally(() => prisma.$disconnect());
