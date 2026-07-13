/** Inventário do catálogo p/ a proposta da aba de ajuste fino (não altera nada). */
import { prisma } from "../src/lib/db";

async function main() {
  const locs = await prisma.catalogLocation.findMany({ orderBy: { name: "asc" } });
  console.log("LOCATIONS:");
  for (const l of locs)
    console.log(
      `  ${l.name}: lote $${Number(l.lotCostEstimate ?? 0).toLocaleString("en-US")} · busca ${l.lotLeadDays}d · permit ${l.permitDays}d · venda ${l.saleDays}d`,
    );
  const mls = await prisma.catalogModelLocation.findMany({
    include: { model: true, location: true },
    orderBy: [{ location: { name: "asc" } }, { model: { name: "asc" } }],
  });
  const fees = await prisma.houseTypeFee.findMany();
  console.log("\nMODELO × LOCATION:");
  for (const ml of mls)
    console.log(
      `  ${ml.model.name} @ ${ml.location.name}: venda $${Number(ml.salePrice).toLocaleString("en-US")} · perf $${Number(ml.costPerformance ?? 0).toLocaleString("en-US")} · contractor $${Number(ml.costContractor ?? 0).toLocaleString("en-US")} · openbook $${Number(ml.costOpenBook ?? 0).toLocaleString("en-US")} · obra ${Number(ml.model.buildMonths)}m · fee ${ml.model.contractorFee != null ? "$" + Number(ml.model.contractorFee).toLocaleString("en-US") + " (override)" : "tipo " + ml.model.houseType}`,
    );
  console.log("\nFEES POR TIPO:");
  for (const f of fees) console.log(`  ${f.type}: $${Number(f.fee).toLocaleString("en-US")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
