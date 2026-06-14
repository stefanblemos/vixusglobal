import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const l2 = await prisma.company.findFirst({ where: { legalName: "L2 Legacy Group" } });
  const jm = await prisma.company.findFirst({ where: { legalName: "J Monteiro Investment LLC" } });
  if (!l2 || !jm) throw new Error("companies not found");

  const existing = await prisma.intercompanyLoan.findFirst({
    where: { lenderCompanyId: l2.id, borrowerCompanyId: jm.id },
  });
  if (existing) {
    console.log(`Loan already exists id=${existing.id}`);
    return;
  }
  const loan = await prisma.intercompanyLoan.create({
    data: {
      lenderCompanyId: l2.id,
      borrowerCompanyId: jm.id,
      principal: "7265.80",
      annualInterestRate: "0",
      startDate: new Date("2026-01-01T00:00:00Z"),
      notes: "Imported from QBO — terms pending.",
    },
  });
  console.log(`Loan created id=${loan.id} (L2 -> J Monteiro, $7265.80)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
