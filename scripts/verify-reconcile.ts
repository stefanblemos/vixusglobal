import { readFileSync } from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { parseQboReport } from "../src/lib/qbo/parse";
import { matchCompany } from "../src/lib/qbo/match";
import { extractPositions, reconcile } from "../src/lib/qbo/reconcile";

const prisma = new PrismaClient();
const fx = (f: string) => readFileSync(path.join(__dirname, "fixtures", f), "utf8");

async function ensureImport(file: string) {
  const report = parseQboReport(fx(file));
  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true },
  });
  const companyId = matchCompany(report.companyName, companies);
  const existing = await prisma.qboImport.findFirst({
    where: { sourceCompanyName: report.companyName, reportKind: "BALANCE_SHEET" },
  });
  if (existing) return;
  await prisma.qboImport.create({
    data: {
      companyId,
      sourceCompanyName: report.companyName,
      reportKind: "BALANCE_SHEET",
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
          currency: "USD",
        })),
      },
    },
  });
  console.log(`Imported ${report.companyName} (matched: ${companyId ? "yes" : "no"})`);
}

async function main() {
  await ensureImport("jm-balance-sheet.csv");

  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true },
  });
  const nameOf = (id: string) => companies.find((c) => c.id === id)?.legalName ?? id;
  const resolve = (n: string) => matchCompany(n, companies);

  const imports = await prisma.qboImport.findMany({
    where: { reportKind: "BALANCE_SHEET", companyId: { not: null } },
    orderBy: { createdAt: "desc" },
    include: { lines: true },
  });
  const seen = new Set<string>();
  const latest = imports.filter((imp) => {
    if (!imp.companyId || seen.has(imp.companyId)) return false;
    seen.add(imp.companyId);
    return true;
  });

  const positions = latest.flatMap((imp) =>
    extractPositions(
      imp.companyId!,
      imp.lines.map((l) => ({
        label: l.label,
        lineType: l.lineType,
        sectionPath: l.sectionPath,
        amount: l.value?.toString() ?? null,
      })),
      resolve,
    ),
  );
  const rows = reconcile(positions);

  console.log("\nReconciliation:");
  for (const r of rows) {
    console.log(
      `  ${nameOf(r.creditorId)} -> ${nameOf(r.debtorId)} | creditor=${r.creditorAmount} debtor=${r.debtorAmount} | ${r.status}`,
    );
  }

  const tie = rows.find(
    (r) =>
      nameOf(r.creditorId) === "L2 Legacy Group" &&
      nameOf(r.debtorId) === "J Monteiro Investment LLC",
  );
  const ok = tie?.status === "RECONCILED" && Math.abs((tie.creditorAmount ?? 0) - 7265.8) < 0.01;
  console.log(
    ok
      ? "\nOK — L2 <-> J Monteiro tie-out reconciled at 7265.80"
      : "\nFAIL — tie-out not reconciled",
  );
  process.exit(ok ? 0 : 1);
}

main().finally(() => prisma.$disconnect());
