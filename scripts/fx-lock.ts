import { PrismaClient } from "@prisma/client";
import { fetchAndLockRates, previousMonthEnd } from "../src/lib/fx/rates";

// Sem argumento: trava o fim do mês anterior (uso em cron mensal).
// Com argumento YYYY-MM-DD: trava essa data específica.
const arg = process.argv[2];

async function main() {
  const dateStr = arg ?? previousMonthEnd(new Date());
  const data = await fetchAndLockRates(dateStr);
  console.log(`Locked FX for ${data.date}:`, data.rates);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => new PrismaClient().$disconnect());
