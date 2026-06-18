import type { PrismaClient } from "@prisma/client";
import { parseGeneralLedger } from "./general-ledger";
import { matchCompany, matchParty, normalizeName } from "./match";

export interface GlImportResult {
  matched: boolean;
  companyName: string;
  transactions: number;
  vendors: number;
  importId?: string;
}

/**
 * Importa um General Ledger (texto CSV) para o banco: grava as transações do
 * razão (LedgerTxn), cria/atualiza os Vendors e um cabeçalho de import.
 * Dedup: substitui o GL anterior da mesma empresa.
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
  const parties = await prisma.party.findMany({ select: { id: true, name: true } });
  // Empresa: respeita a escolha explícita do usuário; senão, auto-match pelo nome.
  const companyId = opts?.companyId ?? matchCompany(gl.companyName, companies);
  if (!companyId) {
    return { matched: false, companyName: gl.companyName, transactions: 0, vendors: 0 };
  }

  // Vendors (coluna Name) — upsert por nome normalizado, ligando a empresa/party se casar.
  const names = [...new Set(gl.transactions.map((t) => t.name).filter((n): n is string => !!n))];
  const vendorMap = new Map<string, string>();
  for (const name of names) {
    const key = normalizeName(name);
    if (!key) continue;
    const mCompany = matchCompany(name, companies);
    const mParty = mCompany ? null : matchParty(name, parties);
    const v = await prisma.vendor.upsert({
      where: { normalizedKey: key },
      update: { matchedCompanyId: mCompany, matchedPartyId: mParty },
      create: { name, normalizedKey: key, matchedCompanyId: mCompany, matchedPartyId: mParty },
    });
    vendorMap.set(name, v.id);
  }

  // Dedup: limpa o GL anterior desta empresa.
  await prisma.ledgerTxn.deleteMany({ where: { companyId } });
  await prisma.qboImport.deleteMany({ where: { companyId, reportKind: "GENERAL_LEDGER" } });

  const imp = await prisma.qboImport.create({
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

  const data = gl.transactions.map((t) => ({
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
  }));
  // Chunk para não estourar o limite de parâmetros do Postgres em GLs grandes.
  const CHUNK = 1000;
  for (let i = 0; i < data.length; i += CHUNK) {
    await prisma.ledgerTxn.createMany({ data: data.slice(i, i + CHUNK) });
  }

  return {
    matched: true,
    companyName: gl.companyName,
    transactions: gl.transactions.length,
    vendors: vendorMap.size,
    importId: imp.id,
  };
}
