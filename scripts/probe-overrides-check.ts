import { prisma } from "../src/lib/db";

async function main() {
  const s = await prisma.poolSimulation.findFirst({
    where: { name: "PH-6" },
    select: { overrides: true, result: true },
  });
  console.log("overrides:", JSON.stringify(s?.overrides));
  const r = s?.result as { kpis?: { profit?: number; irrAnnual?: number } } | null;
  console.log(
    "snapshot: lucro",
    r?.kpis?.profit,
    "· TIR",
    r?.kpis?.irrAnnual == null ? "—" : (r.kpis.irrAnnual * 100).toFixed(1) + "%",
  );
}

main().finally(() => prisma.$disconnect());
