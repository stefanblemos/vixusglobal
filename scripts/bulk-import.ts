import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { parseQboReport } from "../src/lib/qbo/parse";
import { matchCompany } from "../src/lib/qbo/match";

const prisma = new PrismaClient();
const DIR = process.argv[2] ?? "C:\\Users\\stefa\\Downloads";

async function main() {
  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true },
  });

  const files = readdirSync(DIR).filter((f) => f.toLowerCase().endsWith(".csv"));
  let imported = 0;
  let skipped = 0;
  const unmatched: string[] = [];

  for (const file of files) {
    let text: string;
    try {
      text = readFileSync(path.join(DIR, file), "utf8");
    } catch {
      continue;
    }
    const report = parseQboReport(text);
    if (report.reportType === "UNKNOWN" || !report.companyName) {
      skipped++;
      continue;
    }

    const companyId = matchCompany(report.companyName, companies);
    if (!companyId) unmatched.push(report.companyName);

    // dedup por (empresa, tipo, período)
    if (companyId) {
      await prisma.qboImport.deleteMany({
        where: { companyId, reportKind: report.reportType, periodLabel: report.periodLabel },
      });
    }

    await prisma.qboImport.create({
      data: {
        companyId,
        sourceCompanyName: report.companyName,
        reportKind: report.reportType,
        reportTypeLabel: report.reportTypeLabel,
        periodLabel: report.periodLabel,
        basis: report.basis,
        fileName: file,
        columns: report.columns,
        lines: {
          create: report.lines.map((l, i) => ({
            rowIndex: i,
            label: l.label,
            accountCode: l.accountCode,
            sectionPath: l.sectionPath,
            depth: l.depth,
            lineType: l.lineType,
            value: l.values[0] ?? null,
            currency: report.currency,
          })),
        },
      },
    });
    imported++;
    const match = companyId ? "✓" : "UNMATCHED";
    console.log(
      `[${match}] ${report.reportType.padEnd(16)} ${report.currency} ${report.companyName}`,
    );
  }

  console.log(`\nImported: ${imported}, skipped (non-QBO): ${skipped}`);
  if (unmatched.length) console.log(`Unmatched companies: ${[...new Set(unmatched)].join(" | ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
