"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { extractReportFromImage, type ReportImageExtraction } from "@/lib/qbo/extract-image";
import { matchCompany } from "@/lib/qbo/match";
import { QboReportKind } from "@prisma/client";

export interface AnalyzeImageResult {
  report: ReportImageExtraction;
  matchedCompanyId: string | null;
  companies: { id: string; legalName: string }[];
  duplicateId: string | null;
}

export async function analyzeReportImage(
  base64: string,
  mediaType: string,
): Promise<AnalyzeImageResult> {
  const report = await extractReportFromImage(base64, mediaType);
  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true },
    orderBy: { legalName: "asc" },
  });
  const matchedCompanyId = matchCompany(report.companyName, companies);

  const kind = report.reportType === "UNKNOWN" ? null : (report.reportType as QboReportKind);
  const duplicate =
    matchedCompanyId && kind
      ? await prisma.qboImport.findFirst({
          where: { companyId: matchedCompanyId, reportKind: kind, periodLabel: report.periodLabel },
        })
      : null;

  return {
    report,
    matchedCompanyId,
    companies: companies.map((c) => ({ id: c.id, legalName: c.legalName })),
    duplicateId: duplicate?.id ?? null,
  };
}

export async function saveReportImage(input: {
  report: ReportImageExtraction;
  companyId: string | null;
  reportKind: "PROFIT_AND_LOSS" | "BALANCE_SHEET";
  periodLabel: string;
  fileName: string;
}): Promise<void> {
  const { report, companyId, reportKind, periodLabel, fileName } = input;
  const currency = report.currency || "USD";

  if (companyId) {
    await prisma.qboImport.deleteMany({
      where: { companyId, reportKind: reportKind as QboReportKind, periodLabel },
    });
  }

  const imp = await prisma.qboImport.create({
    data: {
      companyId,
      sourceCompanyName: report.companyName,
      reportKind: reportKind as QboReportKind,
      reportTypeLabel: reportKind === "BALANCE_SHEET" ? "Balance Sheet" : "Profit & Loss",
      periodLabel,
      basis: report.basis || null,
      fileName,
      columns: [],
      lines: {
        create: report.lines.map((l, i) => ({
          rowIndex: i,
          label: l.label,
          accountCode: null,
          sectionPath: l.section ? [l.section] : [],
          depth: l.section ? 1 : 0,
          lineType: l.lineType,
          value: l.value != null ? String(l.value) : null,
          currency,
        })),
      },
    },
  });

  revalidatePath("/import");
  revalidatePath("/reserve");
  revalidatePath("/closing");
  redirect(`/import/${imp.id}`);
}
