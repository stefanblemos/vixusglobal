// Funde a duplicada "Vixus International Investments LLC" na Vixus America Investments
// (EIN 38-4204655). Origem: o seed da PH3 (09/07/2026) buscava só em legalName — o nome
// atual é "Vixus America Investments" e os nomes antigos moram em aliases, então o seed
// não achou e criou uma casca. Idempotente: sem duplicada → no-op. Roda ANTES do
// seed-ph3 no build (e o seed agora também busca em aliases — cinto e suspensório).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const ALIAS = "Vixus International Investments LLC";

async function main() {
  const vai = await prisma.company.findFirst({ where: { taxId: "38-4204655" } });
  if (!vai) {
    console.log("fix-vai-dupe: VAI (EIN 38-4204655) não encontrada — nada a fazer");
    return;
  }

  // alias exato que o seed usa — evita recriação futura e ajuda o matching de QBO
  if (!vai.aliases.includes(ALIAS)) {
    await prisma.company.update({ where: { id: vai.id }, data: { aliases: { push: ALIAS } } });
    console.log(`fix-vai-dupe: alias "${ALIAS}" adicionado a ${vai.legalName}`);
  }

  // a duplicada é uma CASCA: sem EIN, sem ledger/imports/IR — nunca fundir algo com dados
  const dupe = await prisma.company.findFirst({
    where: {
      legalName: ALIAS,
      id: { not: vai.id },
      taxId: null,
      ledgerTxns: { none: {} },
      qboImports: { none: {} },
      taxReturns: { none: {} },
    },
    include: { poolMemberships: true },
  });
  if (!dupe) {
    console.log("fix-vai-dupe: sem duplicada — ok");
    return;
  }

  for (const m of dupe.poolMemberships) {
    const existing = await prisma.poolMember.findFirst({
      where: { poolId: m.poolId, companyId: vai.id },
    });
    if (existing) {
      // VAI já é membro do pool: move os lançamentos e apaga o membro duplicado
      await prisma.poolContribution.updateMany({ where: { memberId: m.id }, data: { memberId: existing.id } });
      await prisma.poolDistributionLine.updateMany({ where: { memberId: m.id }, data: { memberId: existing.id } });
      await prisma.poolCapitalCallLine.updateMany({ where: { memberId: m.id }, data: { memberId: existing.id } });
      await prisma.poolMember.delete({ where: { id: m.id } });
    } else {
      await prisma.poolMember.update({ where: { id: m.id }, data: { companyId: vai.id } });
    }
  }
  await prisma.company.delete({ where: { id: dupe.id } });
  console.log(
    `fix-vai-dupe: duplicada ${dupe.id} fundida em ${vai.legalName} (${dupe.poolMemberships.length} membership(s) repontada(s))`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
