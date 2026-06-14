import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const loan = await prisma.intercompanyLoan.findFirst({
    include: { lender: true, borrower: true, transactions: true },
  });
  if (!loan) throw new Error("no loan");
  if (loan.transactions.length > 0) {
    console.log("loan already has transactions");
    return;
  }
  await prisma.loanTransaction.create({
    data: {
      loanId: loan.id,
      type: "DISBURSEMENT",
      amount: "7265.80",
      date: loan.startDate,
      memo: "Initial disbursement (per QBO balance)",
    },
  });
  console.log(`Disbursement added to loan ${loan.id}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
