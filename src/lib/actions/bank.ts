"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { getAdapter, type ParsedStatement } from "@/lib/bank/adapters";
import { reconcileStatement } from "@/lib/bank/reconcile";
import { gunzipB64 } from "@/lib/util/gzip-server";
import type { BankLineStatus } from "@prisma/client";

export interface AnalyzeBankResult {
  statement: ParsedStatement;
  companies: { id: string; legalName: string }[];
  cards: { card: string; count: number }[]; // export multi-cartão → vira 1 extrato por cartão
}

function cardsOf(st: ParsedStatement): { card: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const l of st.lines) if (l.card) counts.set(l.card, (counts.get(l.card) ?? 0) + 1);
  return [...counts.entries()].map(([card, count]) => ({ card, count })).sort((a, b) => a.card.localeCompare(b.card));
}

export async function analyzeBankStatement(
  gz: string,
  bankId: string,
): Promise<AnalyzeBankResult> {
  const adapter = getAdapter(bankId);
  if (!adapter) throw new Error("Unknown bank");
  const statement = adapter.parse(gunzipB64(gz));
  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true },
    orderBy: { legalName: "asc" },
  });
  return { statement, companies, cards: cardsOf(statement) };
}

const d = (iso: string | null) => (iso ? new Date(`${iso}T00:00:00Z`) : null);

export async function saveBankStatement(input: {
  gz: string;
  bankId: string;
  companyId: string;
  fileName: string;
}): Promise<void> {
  const adapter = getAdapter(input.bankId);
  if (!adapter) throw new Error("Unknown bank");
  const st = adapter.parse(gunzipB64(input.gz));

  // Multi-cartão: divide em um extrato por cartão (cada um mapeável à sua conta no GL).
  const cards = cardsOf(st);
  const groups =
    cards.length > 1
      ? cards.map((c) => ({ card: c.card, lines: st.lines.filter((l) => l.card === c.card) }))
      : [{ card: null as string | null, lines: st.lines }];

  let firstId = "";
  for (const g of groups) {
    const dates = g.lines.map((l) => l.date).sort();
    const created = await prisma.bankStatement.create({
      data: {
        companyId: input.companyId,
        bankId: input.bankId,
        bankLabel: adapter.label,
        fileName: g.card ? `${input.fileName} · ••${g.card}` : input.fileName,
        periodStart: g.card ? d(dates[0] ?? null) : d(st.periodStart),
        periodEnd: g.card ? d(dates[dates.length - 1] ?? null) : d(st.periodEnd),
        beginningBalance: g.card ? null : st.beginningBalance,
        endingBalance: g.card ? null : st.endingBalance,
        lines: {
          create: g.lines.map((l) => ({
            date: new Date(`${l.date}T00:00:00Z`),
            description: l.description,
            amount: l.amount,
            balance: l.balance,
          })),
        },
      },
    });
    await reconcileStatement(prisma, created.id);
    if (!firstId) firstId = created.id;
  }

  revalidatePath("/bank");
  // Vários cartões → vai para a lista (vê todos); um só → abre o extrato.
  redirect(groups.length > 1 ? "/bank" : `/bank/${firstId}`);
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
    data: { matchedTxnId: txnId, matchedTxnIds: [txnId], matchNote: null, status: "MATCHED", reviewedAt: new Date() },
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
    data: { status, note: note || null, matchedTxnId: null, matchedTxnIds: [], matchNote: null, reviewedAt: new Date() },
  });
  await refreshLine(lineId);
}

export async function resetLine(lineId: string): Promise<void> {
  await prisma.bankStatementLine.update({
    where: { id: lineId },
    data: { status: "UNREVIEWED", matchedTxnId: null, matchedTxnIds: [], matchNote: null, note: null, reviewedAt: null },
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
    data: { status: "UNREVIEWED", matchedTxnId: null, matchedTxnIds: [], matchNote: null },
  });
  await reconcileStatement(prisma, statementId);
  revalidatePath(`/bank/${statementId}`);
}
