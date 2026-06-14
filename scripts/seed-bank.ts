import { readFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";
import { getAdapter } from "../src/lib/bank/adapters";

const prisma = new PrismaClient();
const FILE = "C:\\Users\\stefa\\Downloads\\stmt.csv";

const d = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

async function main() {
  const company = await prisma.company.findFirst({
    where: { legalName: "14528 Braddock Oak Dr LLC" },
  });
  if (!company) throw new Error("company not found");

  const st = getAdapter("boa")!.parse(readFileSync(FILE, "utf8"));
  await prisma.bankStatement.deleteMany({ where: { companyId: company.id } });
  const created = await prisma.bankStatement.create({
    data: {
      companyId: company.id,
      bankId: "boa",
      bankLabel: "Bank of America",
      fileName: "stmt.csv",
      periodStart: d(st.periodStart),
      periodEnd: d(st.periodEnd),
      beginningBalance: st.beginningBalance,
      endingBalance: st.endingBalance,
      lines: {
        create: st.lines.map((l) => ({
          date: new Date(`${l.date}T00:00:00Z`),
          description: l.description,
          amount: l.amount,
          balance: l.balance,
        })),
      },
    },
  });
  console.log(`Statement imported id=${created.id} (${st.lines.length} lines)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
