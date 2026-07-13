import { prisma } from "../src/lib/db";

async function main() {
  const rs = await prisma.poolSimulation.findMany({
    select: { name: true, compMode: true, fundingMode: true, units: true },
  });
  for (const r of rs) {
    const cy = new Set(((r.units as Array<{ cycle?: number }>) ?? []).map((u) => u.cycle ?? 1)).size;
    console.log(`${r.name} · ${r.compMode} · ${r.fundingMode} · ${cy} ciclo(s)`);
  }
}

main().finally(() => prisma.$disconnect());
