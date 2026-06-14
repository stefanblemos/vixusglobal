"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdapter, type ParsedStatement } from "@/lib/bank/adapters";

export interface AnalyzeBankResult {
  statement: ParsedStatement;
  companies: { id: string; legalName: string }[];
}

export async function analyzeBankStatement(
  text: string,
  bankId: string,
): Promise<AnalyzeBankResult> {
  const adapter = getAdapter(bankId);
  if (!adapter) throw new Error("Unknown bank");
  const statement = adapter.parse(text);
  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true },
    orderBy: { legalName: "asc" },
  });
  return { statement, companies };
}

const d = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

export async function saveBankStatement(input: {
  text: string;
  bankId: string;
  companyId: string;
  fileName: string;
}): Promise<void> {
  const adapter = getAdapter(input.bankId);
  if (!adapter) throw new Error("Unknown bank");
  const st = adapter.parse(input.text);

  const created = await prisma.bankStatement.create({
    data: {
      companyId: input.companyId,
      bankId: input.bankId,
      bankLabel: adapter.label,
      fileName: input.fileName,
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

  revalidatePath("/bank");
  redirect(`/bank/${created.id}`);
}
