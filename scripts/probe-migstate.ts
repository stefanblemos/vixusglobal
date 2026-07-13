import { prisma } from "../src/lib/db";

async function main() {
  const rows = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null; rolled_back_at: Date | null }>>`
    SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations ORDER BY migration_name DESC LIMIT 5`;
  for (const r of rows) console.log(r.migration_name, "| finished:", r.finished_at?.toISOString() ?? "NULL", "| rolledback:", r.rolled_back_at?.toISOString() ?? "-");
}

main().finally(() => prisma.$disconnect());
