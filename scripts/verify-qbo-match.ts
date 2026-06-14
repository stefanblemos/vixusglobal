import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { parseQboReport } from "../src/lib/qbo/parse";
import { matchCompany } from "../src/lib/qbo/match";

const prisma = new PrismaClient();
const fx = (f: string) => readFileSync(path.join(__dirname, "fixtures", f), "utf8");

async function main() {
  let failures = 0;
  const check = (label: string, cond: boolean) => {
    if (!cond) failures++;
    console.log(`${cond ? "OK  " : "FAIL"} | ${label}`);
  };

  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true },
  });

  // L&L (old name) deve casar com L2 Legacy Group via alias
  const ll = parseQboReport(fx("ll-balance-sheet.csv"));
  const llMatchId = matchCompany(ll.companyName, companies);
  const llMatch = companies.find((c) => c.id === llMatchId);
  check(
    `L&L matches L2 Legacy Group (got: ${llMatch?.legalName ?? "none"})`,
    llMatch?.legalName === "L2 Legacy Group",
  );

  // J Monteiro P&L deve casar com a empresa J Monteiro
  const jm = parseQboReport(fx("jm-profit-and-loss.csv"));
  const jmMatch = companies.find((c) => c.id === matchCompany(jm.companyName, companies));
  check(`J Monteiro matches (got: ${jmMatch?.legalName ?? "none"})`, !!jmMatch);

  // Cria um import de exemplo (L&L → L2) se ainda não existir
  const existing = await prisma.qboImport.findFirst({
    where: { sourceCompanyName: ll.companyName, reportKind: "BALANCE_SHEET" },
  });
  let importId = existing?.id;
  if (!existing) {
    const imp = await prisma.qboImport.create({
      data: {
        companyId: llMatchId,
        sourceCompanyName: ll.companyName,
        reportKind: "BALANCE_SHEET",
        reportTypeLabel: ll.reportTypeLabel,
        periodLabel: ll.periodLabel,
        basis: ll.basis,
        fileName: "ll-balance-sheet.csv",
        columns: ll.columns,
        lines: {
          create: ll.lines.map((l, i) => ({
            rowIndex: i,
            label: l.label,
            accountCode: l.accountCode,
            sectionPath: l.sectionPath,
            depth: l.depth,
            lineType: l.lineType,
            value: l.values[0] ?? null,
            currency: "USD",
          })),
        },
      },
    });
    importId = imp.id;
  }
  check(`Import persisted (id=${importId})`, !!importId);

  console.log(failures === 0 ? "\nALL OK" : `\n${failures} FAILED`);
  console.log(`IMPORT_ID=${importId}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().finally(() => prisma.$disconnect());
