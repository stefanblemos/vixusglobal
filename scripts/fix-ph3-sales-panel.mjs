// Data-fix PH3 (Sales Panel, jul/2026): own capital correto por casa (total 503.689,16),
// venda/closing reais da Canfield, e confirmação dos payoffs 411/13663. CONDICIONADO aos
// valores antigos — se o usuário já editou, não sobrescreve. No-op depois de aplicado.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// [address, campo, valorAntigo, valorNovo]
// Valores como STRING: igualdade decimal exata (float 68248.76 = 68248.7599… e não casa)
const FIXES = [
  ["411 Marion Oaks Golf Rd", "ownCapital", "48561.89", "69561.89"],
  ["13663 SW 42nd Ave", "ownCapital", "49216.16", "70216.16"],
  ["12659 SW 64th Ln", "ownCapital", "68248.76", "91948.76"],
  ["16965 SW 50th Cir", "ownCapital", "48664.23", "63091.68"],
  ["6440 N Canfield Way", "soldPrice", "279900", "280400"],
  ["6440 N Canfield Way", "closingCost", "25256.79", "25716.79"],
  ["6440 N Canfield Way", "netReceived", "9518.21", "9558.21"],
];

async function main() {
  const pool = await prisma.investmentPool.findUnique({ where: { code: "VHP-I" } });
  if (!pool) return console.log("VHP-I não existe — nada a corrigir");
  let applied = 0;
  for (const [address, field, oldVal, newVal] of FIXES) {
    const res = await prisma.poolHouse.updateMany({
      where: { poolId: pool.id, address, [field]: oldVal },
      data: { [field]: newVal },
    });
    applied += res.count;
  }
  // payoffs 411/13663 confirmados pelo Sales Panel — remove o aviso das notas
  const notes = await prisma.poolHouse.updateMany({
    where: { poolId: pool.id, notes: { contains: "CONFIRMAR" } },
    data: { notes: "Payoff confirmado pelo Sales Panel (jul/2026)" },
  });
  console.log(`sales-panel fix: ${applied} campos atualizados, ${notes.count} notas confirmadas`);
}

main().finally(() => prisma.$disconnect());
