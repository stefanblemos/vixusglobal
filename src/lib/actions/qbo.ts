"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { parseQboReport, type QboReport } from "@/lib/qbo/parse";
import { matchCompany } from "@/lib/qbo/match";
import { QboReportKind } from "@prisma/client";

export interface AnalyzeResult {
  report: QboReport;
  matchedCompanyId: string | null;
  companies: { id: string; legalName: string }[];
  duplicateId: string | null; // import já existente para (empresa, tipo, período)
}

export async function analyzeQbo(text: string): Promise<AnalyzeResult> {
  const report = parseQboReport(text);
  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true },
    orderBy: { legalName: "asc" },
  });
  const matchedCompanyId = matchCompany(report.companyName, companies);

  const duplicate = matchedCompanyId
    ? await prisma.qboImport.findFirst({
        where: {
          companyId: matchedCompanyId,
          reportKind: report.reportType as QboReportKind,
          periodLabel: report.periodLabel,
        },
      })
    : null;

  return {
    report,
    matchedCompanyId,
    companies: companies.map((c) => ({ id: c.id, legalName: c.legalName })),
    duplicateId: duplicate?.id ?? null,
  };
}

export async function saveQboImport(input: {
  text: string;
  companyId: string | null;
  fileName: string;
}): Promise<void> {
  const report = parseQboReport(input.text);
  const companyId = input.companyId || null;

  const currency = report.currency;

  // Dedup: substitui um import anterior do mesmo (empresa, tipo, período).
  if (companyId) {
    await prisma.qboImport.deleteMany({
      where: {
        companyId,
        reportKind: report.reportType as QboReportKind,
        periodLabel: report.periodLabel,
      },
    });
  }

  const imp = await prisma.qboImport.create({
    data: {
      companyId,
      sourceCompanyName: report.companyName,
      reportKind: report.reportType as QboReportKind,
      reportTypeLabel: report.reportTypeLabel,
      periodLabel: report.periodLabel,
      basis: report.basis,
      fileName: input.fileName,
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
          currency,
        })),
      },
    },
  });

  revalidatePath("/import");
  redirect(`/import/${imp.id}`);
}
