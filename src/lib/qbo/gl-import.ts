import type { PrismaClient } from "@prisma/client";
import { parseGeneralLedger } from "./general-ledger";
import { matchCompany, matchParty, normalizeName } from "./match";

export interface GlImportResult {
  matched: boolean;
  companyName: string;
  transactions: number; // total de linhas no arquivo
  added: number; // linhas novas gravadas
  skipped: number; // duplicadas ignoradas (já existiam)
  vendors: number;
  importId?: string;
}

const yearOf = (s: string | null | undefined) => {
  const m = (s ?? "").match(/(20\d\d)/);
  return m ? Number(m[0]) : null;
};

// Chave de identidade de uma linha do razão — para deduplicar entre reimportações
// (mesma data + valor + conta + memo + nº = a mesma transação). Centavos (2 casas).
const txnKey = (p: {
  date: string;
  amount: string;
  account: string;
  description: string | null;
  num: string | null;
}) =>
  [
    p.date,
    Number(p.amount || "0").toFixed(2),
    p.account.trim(),
    (p.description ?? "").trim(),
    (p.num ?? "").trim(),
  ].join("|");

/**
 * Importa um General Ledger (texto CSV) de forma ADITIVA e segura:
 *  • NUNCA apaga transações — só insere as linhas novas (dedup por data+valor+conta+memo+nº),
 *    preservando ids (e portanto os vínculos de reconciliação bancária);
 *  • um cabeçalho de import por ANO — reusa o do mesmo ano, mantém os de outros anos
 *    (2024 e 2025 são complementares, não substitutos).
 */
export async function importGeneralLedger(
  prisma: PrismaClient,
  csvText: string,
  fileName: string,
  opts?: { companyId?: string | null },
): Promise<GlImportResult> {
  const gl = parseGeneralLedger(csvText);

  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true },
  });
  const parties = await prisma.party.findMany({ select: { id: true, name: true, aliases: true } });
  // Empresa: respeita a escolha explícita do usuário; senão, auto-match pelo nome.
  const companyId = opts?.companyId ?? matchCompany(gl.companyName, companies);
  if (!companyId) {
    return { matched: false, companyName: gl.companyName, transactions: 0, added: 0, skipped: 0, vendors: 0 };
  }

  // O QBO é a fonte da moeda da empresa — sincroniza baseCurrency (ex.: EUR para PT).
  if (gl.currency) {
    await prisma.company.update({ where: { id: companyId }, data: { baseCurrency: gl.currency } });
  }

  // Vendors (coluna Name) — upsert por CHAVE normalizada. Deduplica por chave (vários nomes
  // crus podem normalizar igual) e processa em lotes paralelos — em GLs grandes (50k+ linhas)
  // o loop sequencial estourava o tempo da função.
  const names = [...new Set(gl.transactions.map((t) => t.name).filter((n): n is string => !!n))];
  const byKey = new Map<string, string>(); // chave normalizada → 1 nome representativo
  for (const name of names) {
    const key = normalizeName(name);
    if (key && !byKey.has(key)) byKey.set(key, name);
  }
  const keyToVendor = new Map<string, string>();
  const keyEntries = [...byKey.entries()];
  const VCHUNK = 25;
  for (let i = 0; i < keyEntries.length; i += VCHUNK) {
    const batch = keyEntries.slice(i, i + VCHUNK);
    const res = await Promise.all(
      batch.map(async ([key, name]) => {
        const mCompany = matchCompany(name, companies);
        const mParty = mCompany ? null : matchParty(name, parties);
        const v = await prisma.vendor.upsert({
          where: { normalizedKey: key },
          update: { matchedCompanyId: mCompany, matchedPartyId: mParty },
          create: { name, normalizedKey: key, matchedCompanyId: mCompany, matchedPartyId: mParty },
        });
        return [key, v.id] as const;
      }),
    );
    for (const [key, id] of res) keyToVendor.set(key, id);
  }
  const vendorMap = new Map<string, string>();
  for (const name of names) {
    const id = keyToVendor.get(normalizeName(name));
    if (id) vendorMap.set(name, id);
  }

  // Ano do GL — do rótulo do período, senão do ano mais frequente entre as transações.
  let glYear = yearOf(gl.periodLabel);
  if (glYear == null) {
    const counts = new Map<number, number>();
    for (const t of gl.transactions) {
      const y = yearOf(t.date);
      if (y) counts.set(y, (counts.get(y) ?? 0) + 1);
    }
    glYear = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  }

  // Cabeçalho de import por ANO: reusa o do mesmo ano (atualiza), mantém os de outros anos.
  const existingGl = await prisma.qboImport.findMany({
    where: { companyId, reportKind: "GENERAL_LEDGER" },
    select: { id: true, periodLabel: true },
  });
  const sameYear = glYear != null ? existingGl.find((i) => yearOf(i.periodLabel) === glYear) : undefined;

  const imp = sameYear
    ? await prisma.qboImport.update({
        where: { id: sameYear.id },
        data: { sourceCompanyName: gl.companyName, periodLabel: gl.periodLabel, fileName },
      })
    : await prisma.qboImport.create({
        data: {
          companyId,
          sourceCompanyName: gl.companyName,
          reportKind: "GENERAL_LEDGER",
          reportTypeLabel: "General Ledger",
          periodLabel: gl.periodLabel,
          fileName,
          columns: [],
        },
      });

  // Dedup ADITIVO: multiset das linhas que já existem (toda a empresa). Só insere as que
  // ainda não estão lá — nunca apaga (preserva ids e os matches de reconciliação bancária).
  const existing = await prisma.ledgerTxn.findMany({
    where: { companyId },
    select: { date: true, amount: true, account: true, description: true, num: true },
  });
  const have = new Map<string, number>();
  for (const t of existing) {
    const k = txnKey({
      date: t.date.toISOString().slice(0, 10),
      amount: t.amount.toString(),
      account: t.account,
      description: t.description,
      num: t.num,
    });
    have.set(k, (have.get(k) ?? 0) + 1);
  }

  const data: {
    companyId: string;
    importId: string;
    account: string;
    date: Date;
    type: string;
    num: string | null;
    vendorId: string | null;
    rawName: string | null;
    description: string | null;
    split: string | null;
    amount: string;
    currency: string;
  }[] = [];
  let skipped = 0;
  for (const t of gl.transactions) {
    const k = txnKey({ date: t.date, amount: t.amount ?? "0", account: t.account, description: t.description, num: t.num });
    const left = have.get(k) ?? 0;
    if (left > 0) {
      have.set(k, left - 1); // já existe essa ocorrência → ignora (duplicada)
      skipped += 1;
      continue;
    }
    data.push({
      companyId,
      importId: imp.id,
      account: t.account,
      date: new Date(`${t.date}T00:00:00Z`),
      type: t.type,
      num: t.num,
      vendorId: t.name ? (vendorMap.get(t.name) ?? null) : null,
      rawName: t.name,
      description: t.description,
      split: t.split,
      amount: t.amount ?? "0",
      currency: gl.currency,
    });
  }

  // Chunk para não estourar o limite de parâmetros do Postgres em GLs grandes.
  const CHUNK = 1000;
  for (let i = 0; i < data.length; i += CHUNK) {
    await prisma.ledgerTxn.createMany({ data: data.slice(i, i + CHUNK) });
  }

  // Saldos por conta (saldo final p/ BS, movimento p/ P&L) — sempre refletem o último arquivo
  // do ano: recria os do import reusado.
  await prisma.glAccountSummary.deleteMany({ where: { importId: imp.id } });
  if (gl.accountBalances.length > 0) {
    await prisma.glAccountSummary.createMany({
      data: gl.accountBalances.map((b) => ({
        importId: imp.id,
        companyId,
        account: b.account,
        beginning: b.beginning,
        ending: b.ending,
      })),
    });
  }

  return {
    matched: true,
    companyName: gl.companyName,
    transactions: gl.transactions.length,
    added: data.length,
    skipped,
    vendors: vendorMap.size,
    importId: imp.id,
  };
}
