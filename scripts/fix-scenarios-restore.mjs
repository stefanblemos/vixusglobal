// Data-fix: o seed sobrescrevia os cenários a cada deploy (update: s) e apagou os ajustes
// do Stefan no Conservador feitos em 10/07/2026 (registrados no CatalogChangeLog mas
// revertidos pelo deploy seguinte). Restaura os valores-alvo do changelog, CONDICIONADO:
// cada campo só é aplicado se ainda estiver no default do seed (não pisa em edição nova).
// No-op depois que o usuário mexer de novo — pode ser removido em algumas semanas.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// campo: [default do seed que o deploy re-aplicou, valor-alvo do changelog do Stefan]
const CONS_RESTORE = {
  lotCostBufferPct: [5, 1],
  emdPct: [10, 5],
  constructionCostBufferPct: [10, 2],
  contingencyReservePct: [8, 3],
  salePriceBufferPct: [-7, -2],
  closingFeePct: [9, 11],
};

async function main() {
  const cons = await prisma.bufferScenario.findUnique({ where: { code: "CONS" } });
  if (!cons) return console.log("CONS não encontrado");
  const data = {};
  for (const [field, [seedDefault, target]] of Object.entries(CONS_RESTORE)) {
    if (Number(cons[field]) === seedDefault) data[field] = target;
  }
  if (Object.keys(data).length === 0) return console.log("CONS já ajustado — nada a restaurar");
  await prisma.bufferScenario.update({ where: { code: "CONS" }, data });
  console.log("CONS restaurado:", JSON.stringify(data));
}

main().finally(() => prisma.$disconnect());
