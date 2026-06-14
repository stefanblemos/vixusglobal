import { PrismaClient } from "@prisma/client";
import { matchCompany } from "../src/lib/qbo/match";
import { extractPositions, reconcile } from "../src/lib/qbo/reconcile";

const prisma = new PrismaClient();

async function main() {
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

  const f = (n: number | null) =>
    n == null
      ? "—"
      : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  for (const r of rows.sort((a, b) => a.status.localeCompare(b.status))) {
    console.log(
      `${r.status.padEnd(11)} | ${nameOf(r.creditorId).padEnd(34)} -> ${nameOf(r.debtorId).padEnd(34)} | cred ${f(r.creditorAmount).padStart(14)} | deb ${f(r.debtorAmount).padStart(14)}`,
    );
  }
  console.log(
    `\nReconciled: ${rows.filter((r) => r.status === "RECONCILED").length} | Mismatch: ${rows.filter((r) => r.status === "MISMATCH").length} | One-sided: ${rows.filter((r) => r.status === "ONE_SIDED").length}`,
  );
}

main().finally(() => prisma.$disconnect());
