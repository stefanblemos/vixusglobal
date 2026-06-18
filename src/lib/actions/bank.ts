"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdapter, type ParsedStatement } from "@/lib/bank/adapters";
import { reconcileStatement } from "@/lib/bank/reconcile";
import type { BankLineStatus } from "@prisma/client";

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

  await reconcileStatement(prisma, created.id);
  revalidatePath("/bank");
  redirect(`/bank/${created.id}`);
}

export interface MatchCandidate {
  id: string;
  date: string;
  account: string;
  split: string | null;
  vendor: string | null;
  amount: string;
}

/** Candidatos do razão para casar manualmente uma linha do extrato (mesmo valor). */
export async function getMatchCandidates(lineId: string): Promise<MatchCandidate[]> {
  const line = await prisma.bankStatementLine.findUnique({
    where: { id: lineId },
    include: { statement: true },
  });
  if (!line) return [];

  const amount = Number(line.amount.toString());
  const lo = (amount - 0.005).toFixed(4);
  const hi = (amount + 0.005).toFixed(4);

  // Já casados por outras linhas (não oferecer de novo).
  const taken = await prisma.bankStatementLine.findMany({
    where: { statementId: line.statementId, matchedTxnId: { not: null }, id: { not: lineId } },
    select: { matchedTxnId: true },
  });
  const takenIds = new Set(taken.map((t) => t.matchedTxnId!));

  const txns = await prisma.ledgerTxn.findMany({
    where: {
      companyId: line.statement.companyId,
      amount: { gte: lo, lte: hi },
      // Só oferece lançamentos da conta-caixa mapeada (GL ≠ extrato).
      ...(line.statement.glAccount ? { account: line.statement.glAccount } : {}),
    },
    include: { vendor: true },
    take: 50,
  });

  return txns
    .filter((t) => !takenIds.has(t.id))
    .sort(
      (a, b) =>
        Math.abs(a.date.getTime() - line.date.getTime()) -
        Math.abs(b.date.getTime() - line.date.getTime()),
    )
    .slice(0, 15)
    .map((t) => ({
      id: t.id,
      date: t.date.toISOString().slice(0, 10),
      account: t.account,
      split: t.split,
      vendor: t.vendor?.name ?? t.rawName ?? null,
      amount: t.amount.toString(),
    }));
}

async function refreshLine(lineId: string) {
  const line = await prisma.bankStatementLine.findUnique({ where: { id: lineId } });
  if (line) revalidatePath(`/bank/${line.statementId}`);
}

export async function matchLine(lineId: string, txnId: string): Promise<void> {
  await prisma.bankStatementLine.update({
    where: { id: lineId },
    data: { matchedTxnId: txnId, status: "MATCHED", reviewedAt: new Date() },
  });
  await refreshLine(lineId);
}

export async function reviewLine(
  lineId: string,
  status: BankLineStatus,
  note: string,
): Promise<void> {
  await prisma.bankStatementLine.update({
    where: { id: lineId },
    data: { status, note: note || null, matchedTxnId: null, reviewedAt: new Date() },
  });
  await refreshLine(lineId);
}

export async function resetLine(lineId: string): Promise<void> {
  await prisma.bankStatementLine.update({
    where: { id: lineId },
    data: { status: "UNREVIEWED", matchedTxnId: null, note: null, reviewedAt: null },
  });
  await refreshLine(lineId);
}

/**
 * Mapeia o extrato à conta-caixa do GL e refaz o auto-match dentro desse escopo.
 * Reseta apenas os matches automáticos (MATCHED sem reviewedAt) — decisões manuais
 * (match manual, FLAGGED, IGNORED) são preservadas.
 */
export async function setStatementGlAccount(
  statementId: string,
  glAccount: string,
): Promise<void> {
  await prisma.bankStatement.update({
    where: { id: statementId },
    data: { glAccount: glAccount || null },
  });
  // Limpa matches automáticos para reavaliar no novo escopo.
  await prisma.bankStatementLine.updateMany({
    where: { statementId, status: "MATCHED", reviewedAt: null },
    data: { status: "UNREVIEWED", matchedTxnId: null },
  });
  await reconcileStatement(prisma, statementId);
  revalidatePath(`/bank/${statementId}`);
}
