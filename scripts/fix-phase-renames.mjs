// Renames 16/07 (regra do Stefan): pools da fase Vixus (sem empresa nova — a Vixus é o
// veículo) chamam "Phase - X" com code PH-X. Os códigos VHP-* ficam RESERVADOS para as
// entidades dedicadas que começam na PH7 (a próxima conversão VHP gera VHP-I).
// Idempotente: guarda por code atual + alias; sem alvo → no-op. Roda ANTES do seed-ph3.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const RENAMES = [
  { fromCode: "VHP-I", alias: "PH3", toCode: "PH-3", toName: "Phase - 3" },
  { fromCode: "VHP-II", alias: "PH4", toCode: "PH-4", toName: "Phase - 4" },
];

async function main() {
  // Casca "VHP-I" criada por BUILD FORA DE ORDEM (16/07: webhook atrasado re-rodou o
  // seed-ph3 antigo, que buscava VHP-I, depois do rename → criou duplicata do PH3).
  // Guardas: alias PH3 + criada em/após 16/07 + SEM dados de usuário (distribuições,
  // calls, expenses, sim vinculada) — o PH-3 verdadeiro é de 09/07 e tem tudo original.
  const shell = await prisma.investmentPool.findFirst({
    where: {
      code: "VHP-I",
      alias: "PH3",
      createdAt: { gte: new Date("2026-07-16T00:00:00Z") },
      distributions: { none: {} },
      capitalCalls: { none: {} },
      expenses: { none: {} },
      simulations: { none: {} },
    },
    include: { members: { select: { id: true } } },
  });
  if (shell) {
    const memberIds = shell.members.map((m) => m.id);
    await prisma.poolContribution.deleteMany({ where: { memberId: { in: memberIds } } });
    await prisma.poolMember.deleteMany({ where: { poolId: shell.id } });
    await prisma.poolLoanEntry.deleteMany({ where: { loan: { poolId: shell.id } } });
    await prisma.poolLoan.deleteMany({ where: { poolId: shell.id } });
    await prisma.poolHouse.deleteMany({ where: { poolId: shell.id } });
    await prisma.investmentPool.delete({ where: { id: shell.id } });
    console.log("fix-phase-renames: casca VHP-I (duplicata do PH3, build fora de ordem) removida");
  }

  for (const r of RENAMES) {
    const pool = await prisma.investmentPool.findUnique({ where: { code: r.fromCode } });
    if (!pool || pool.alias !== r.alias) {
      console.log(`fix-phase-renames: ${r.fromCode} (${r.alias}) — nada a fazer`);
      continue;
    }
    const taken = await prisma.investmentPool.findUnique({ where: { code: r.toCode } });
    if (taken) {
      console.log(`fix-phase-renames: ${r.toCode} já existe — pulei ${r.fromCode}`);
      continue;
    }
    await prisma.investmentPool.update({
      where: { id: pool.id },
      data: { code: r.toCode, name: r.toName },
    });
    console.log(`fix-phase-renames: ${r.fromCode} → ${r.toCode} ("${r.toName}")`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
