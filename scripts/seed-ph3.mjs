// Seed do pool REAL VHP-I (PH3 / loan 77959 Builders Capital) — idempotente e create-only.
// Fontes: planilha de aportes do Airtable (24 aportes, 8 investidores, total 578.157,57),
// Job List da PH3 (casas) e transaction history do banco (scripts/ph3-loan-entries.json).
// Datas marcadas "DATA A CONFIRMAR" serão ajustadas pelo Stefan com o QBO.
import { PrismaClient } from "@prisma/client";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const prisma = new PrismaClient();
const here = dirname(fileURLToPath(import.meta.url));

// ── Investidores (empresas) e aportes ────────────────────────
const INVESTORS = [
  { key: "VIX", name: "Vixus International Investments LLC", role: "MANAGER", group: true },
  { key: "LRH", name: "LR Homes Investments LLC", role: "INVESTOR" },
  { key: "ALD", name: "ALD Management LLC", role: "INVESTOR" },
  { key: "RMN", name: "Romano Investment Partners LLC", role: "INVESTOR" },
  { key: "BON", name: "Bonomo Investments LLC", role: "INVESTOR" },
  { key: "R&D", name: "Rezini & Dias Investments LLC", role: "INVESTOR" },
  { key: "K&L", name: "K&L Real Investment LLC", role: "INVESTOR" },
  { key: "SHM", name: "Sunset Homes Investments LLC", role: "INVESTOR" },
];

const CONTRIBUTIONS = [
  { key: "VIX", amount: 138977.89, date: "2025-05-12", memo: "DATA A CONFIRMAR no QBO" },
  { key: "LRH", amount: 6906.0, date: "2025-05-12" },
  { key: "ALD", amount: 6906.0, date: "2025-05-12" },
  { key: "RMN", amount: 39226.0, date: "2025-05-12" },
  { key: "LRH", amount: 5090.13, date: "2025-05-13" },
  { key: "RMN", amount: 20000.0, date: "2025-05-13" },
  { key: "R&D", amount: 33216.27, date: "2025-05-14" },
  { key: "ALD", amount: 45000.0, date: "2025-05-15" },
  { key: "BON", amount: 17985.11, date: "2025-05-15" },
  { key: "BON", amount: 24456.4, date: "2025-05-15" },
  { key: "R&D", amount: 34432.6, date: "2025-05-16" },
  { key: "BON", amount: 24000.0, date: "2025-05-29" },
  { key: "ALD", amount: 7000.0, date: "2025-06-16" },
  { key: "K&L", amount: 23014.3, date: "2025-06-18", memo: "DATA A CONFIRMAR no QBO" },
  { key: "K&L", amount: 26984.24, date: "2025-06-18" },
  { key: "SHM", amount: 47000.0, date: "2025-07-25" },
  { key: "LRH", amount: 25003.87, date: "2025-07-29" },
  { key: "LRH", amount: 3003.87, date: "2025-08-08" },
  { key: "VIX", amount: 593.09, date: "2025-08-14" },
  { key: "VIX", amount: 167.15, date: "2025-09-22" },
  { key: "VIX", amount: 650.0, date: "2025-09-26" },
  { key: "VIX", amount: 650.0, date: "2025-09-29" },
  { key: "VIX", amount: 1350.0, date: "2025-10-10" },
  { key: "VIX", amount: 46544.65, date: "2025-10-13" },
];

// ── Casas (Job List da PH3; custos totais nas notas — split lote/obra a preencher) ──
const HOUSES = [
  { address: "21021 Peachland Blvd", status: "FOR_SALE", plannedSalePrice: 345000, ownCapital: 52279.4, notes: "Original cost 315,676.43 (planilha PH3); venda estimada 345k (jul/2026)" },
  { address: "6440 N Canfield Way", status: "SOLD", soldPrice: 280400, payoffAmount: 245125, closingCost: 25716.79, netReceived: 9558.21, ownCapital: 41514.3, saleDate: "2026-03-24", notes: "Original cost 208,014.30" },
  { address: "6079 SW 150th Ln", status: "SOLD", soldPrice: 318000, payoffAmount: 282350, closingCost: 30906.72, netReceived: 4743.28, ownCapital: 67413.65, saleDate: "2026-04-28", notes: "Original cost 238,913.65" },
  { address: "13222 Irwin Dr", status: "SOLD", soldPrice: 374900, payoffAmount: 319198, closingCost: 37414.74, netReceived: 18287.26, ownCapital: 47663.32, saleDate: "2026-06-05", notes: "Original cost 314,630.87" },
  { address: "12659 SW 64th Ln", status: "SOLD", soldPrice: 519900, payoffAmount: 221455.04, closingCost: 49088.89, netReceived: 249356.07, ownCapital: 91948.76, saleDate: "2026-07-02", notes: "Original cost 345,948.76; payoff final no extrato: 221,979.30" },
  { address: "16965 SW 50th Cir", status: "SOLD", soldPrice: 348900, payoffAmount: 285898, closingCost: 32911.54, netReceived: 30090.46, ownCapital: 63091.68, saleDate: "2026-06-15", notes: "Original cost 227,091.68" },
  { address: "411 Marion Oaks Golf Rd", status: "SOLD", soldPrice: 350000, payoffAmount: 294103.35, saleDate: "2026-04-20", ownCapital: 69561.89, notes: "Payoff confirmado pelo Sales Panel (jul/2026)" },
  { address: "13663 SW 42nd Ave", status: "SOLD", soldPrice: 349000, payoffAmount: 287563, saleDate: "2026-06-03", ownCapital: 70216.16, notes: "Payoff confirmado pelo Sales Panel (jul/2026)" },
];

async function findOrCreateCompany(inv) {
  const token = inv.name.split(" ")[0]; // "Vixus" não serve — usa token distintivo
  const distinct = { VIX: "Vixus International", LRH: "LR Homes", ALD: "ALD", RMN: "Romano", BON: "Bonomo", "R&D": "Rezini", "K&L": "K&L", SHM: "Sunset Homes" }[inv.key] ?? token;
  const existing = await prisma.company.findFirst({
    where: { legalName: { contains: distinct, mode: "insensitive" } },
  });
  if (existing) return existing;
  return prisma.company.create({
    data: {
      legalName: inv.name,
      jurisdiction: "US",
      state: "FL",
      entityType: "LLC",
      relationship: inv.group ? "GROUP_MEMBER" : "MANAGED_ONLY",
      monitored: false,
      controlsTax: false,
      notes: "Criada pelo seed da PH3 — completar cadastro (EIN, etc.)",
    },
  });
}

async function main() {
  // 1. Pool
  const pool = await prisma.investmentPool.upsert({
    where: { code: "VHP-I" },
    create: {
      code: "VHP-I",
      name: "Vixus Home Partners I LLC",
      alias: "PH3",
      status: "CLOSING",
      targetAmount: 578157.57,
      profitSharePct: 0.35,
      profitShareTiming: "PROJECT_COMPLETION",
      startDate: new Date("2025-05-01"),
      plannedEndDate: new Date("2026-05-01"),
      notes: "Pool real (loan 77959 Builders Capital). Populado do Airtable/extrato em jul/2026.",
    },
    update: { status: "CLOSING" },
  });

  // limpeza de artefatos de teste (só se existirem): aporte de teste e manager de teste
  const testEntry = await prisma.poolContribution.findFirst({
    where: { member: { poolId: pool.id }, memo: "Aporte inicial", amount: 17985.11 },
  });
  if (testEntry) await prisma.poolContribution.delete({ where: { id: testEntry.id } });
  const testManager = await prisma.poolMember.findFirst({
    where: { poolId: pool.id, company: { legalName: "Vixus Investment Partners LLC" }, entries: { none: {} } },
  });
  if (testManager) await prisma.poolMember.delete({ where: { id: testManager.id } });

  // 2. Empresas + membros
  const memberByKey = {};
  for (const inv of INVESTORS) {
    const company = await findOrCreateCompany(inv);
    let member = await prisma.poolMember.findFirst({ where: { poolId: pool.id, companyId: company.id } });
    if (!member) {
      member = await prisma.poolMember.create({
        data: { poolId: pool.id, companyId: company.id, role: inv.role },
      });
    }
    memberByKey[inv.key] = member;
  }

  // 3. Aportes (só se o pool ainda não tem nenhum — create-only)
  const existingContribs = await prisma.poolContribution.count({ where: { member: { poolId: pool.id } } });
  if (existingContribs === 0) {
    for (const c of CONTRIBUTIONS) {
      await prisma.poolContribution.create({
        data: {
          memberId: memberByKey[c.key].id,
          kind: "CONTRIBUTION",
          date: new Date(c.date),
          amount: c.amount,
          units: Math.round((c.amount / 1000) * 10000) / 10000,
          memo: c.memo ?? "Aporte (planilha PH3)",
        },
      });
    }
  }

  // 4. Casas — create-only NO NÍVEL DO POOL: se já existe qualquer casa, não cria nada
  // (senão renomear um placeholder faz o deploy recriá-lo). Limpeza: placeholders
  // "endereco a preencher" que sobraram de deploys anteriores são removidos.
  await prisma.poolHouse.deleteMany({
    where: { poolId: pool.id, address: { contains: "endereco a preencher" } },
  });
  const existingHouses = await prisma.poolHouse.count({ where: { poolId: pool.id } });
  const houseByAddress = {};
  if (existingHouses === 0) {
    for (const h of HOUSES) {
      const { saleDate, ...rest } = h;
      houseByAddress[h.address] = await prisma.poolHouse.create({
        data: { poolId: pool.id, ...rest, saleDate: saleDate ? new Date(saleDate) : null },
      });
    }
  } else {
    for (const h of HOUSES) {
      const house = await prisma.poolHouse.findFirst({ where: { poolId: pool.id, address: h.address } });
      if (house) houseByAddress[h.address] = house;
    }
  }

  // 5. Loan 77959 + statement completo do extrato (create-only)
  const bc = await prisma.bankProfile.findUnique({ where: { name: "Builders Capital" } });
  const loan = await prisma.poolLoan.upsert({
    where: { poolId: pool.id },
    create: {
      poolId: pool.id,
      bankProfileId: bc?.id ?? null,
      loanNumber: "77959",
      committed: 1981564,
      aprPct: 9,
      closingDate: new Date("2025-10-30"),
      notes: "Vixus 8 SFR — statement importado do transaction history do banco.",
    },
    update: {},
  });
  const existingEntries = await prisma.poolLoanEntry.count({ where: { loanId: loan.id } });
  if (existingEntries === 0) {
    const entries = JSON.parse(readFileSync(join(here, "ph3-loan-entries.json"), "utf8"));
    for (const e of entries) {
      await prisma.poolLoanEntry.create({
        data: {
          loanId: loan.id,
          houseId: e.houseAddress ? (houseByAddress[e.houseAddress]?.id ?? null) : null,
          type: e.type,
          date: new Date(e.date),
          amount: e.amount,
          memo: e.memo,
          reconciled: true, // a fonte É o extrato do banco
        },
      });
    }
  }

  // 6. Backfill: vincula os 16 draws às casas (planilha de draws do Stefan, jul/2026 —
  // datas do STATEMENT, não da planilha) e grava o loan aprovado por casa (Bank Budget).
  // Idempotente: só draws sem casa; budget só se ainda vazio (não sobrescreve ajustes).
  const DRAW_MAP = [
    { date: "2026-01-16", amount: 162000, address: "6079 SW 150th Ln" },
    { date: "2026-01-16", amount: 91000, address: "12659 SW 64th Ln" },
    { date: "2026-01-16", amount: 188000, address: "411 Marion Oaks Golf Rd" },
    { date: "2026-01-16", amount: 188000, address: "16965 SW 50th Cir" },
    { date: "2026-01-16", amount: 189349, address: "21021 Peachland Blvd" },
    { date: "2026-01-16", amount: 164577, address: "6440 N Canfield Way" },
    { date: "2026-01-16", amount: 156715, address: "13222 Irwin Dr" },
    { date: "2026-03-05", amount: 35123, address: "6440 N Canfield Way" },
    { date: "2026-03-24", amount: 22000, address: "411 Marion Oaks Golf Rd" },
    { date: "2026-04-03", amount: 33000, address: "6079 SW 150th Ln" },
    { date: "2026-04-08", amount: 22000, address: "16965 SW 50th Cir" },
    { date: "2026-05-11", amount: 112975, address: "13222 Irwin Dr" },
    { date: "2026-05-11", amount: 60705, address: "12659 SW 64th Ln" },
    { date: "2026-05-19", amount: 60651, address: "21021 Peachland Blvd" },
    { date: "2026-05-19", amount: 195000, address: "13663 SW 42nd Ave" },
    { date: "2026-05-19", amount: 118295, address: "12659 SW 64th Ln" },
  ];
  const BANK_BUDGETS = {
    "411 Marion Oaks Golf Rd": 210000,
    "13663 SW 42nd Ave": 195000,
    "21021 Peachland Blvd": 250000,
    "6440 N Canfield Way": 200000,
    "6079 SW 150th Ln": 195000,
    "13222 Irwin Dr": 270000,
    "12659 SW 64th Ln": 270000,
    "16965 SW 50th Cir": 210000,
  };
  const allHouses = await prisma.poolHouse.findMany({ where: { poolId: pool.id } });
  const byAddress = Object.fromEntries(allHouses.map((h) => [h.address, h]));
  for (const [address, budget] of Object.entries(BANK_BUDGETS)) {
    const h = byAddress[address];
    if (h && h.bankLoanAmount == null) {
      await prisma.poolHouse.update({ where: { id: h.id }, data: { bankLoanAmount: budget } });
    }
  }
  // draws sem casa, agrupados por (data, valor); duplicatas (2× 188k em 16/01) atribuídas
  // na ordem do statement (createdAt)
  const unlinked = await prisma.poolLoanEntry.findMany({
    where: { loanId: loan.id, type: "DRAW", houseId: null },
    orderBy: { createdAt: "asc" },
  });
  const remaining = [...DRAW_MAP];
  for (const entry of unlinked) {
    const key = entry.date.toISOString().slice(0, 10);
    const idx = remaining.findIndex(
      (m) => m.date === key && Math.abs(m.amount - Number(entry.amount)) < 0.01,
    );
    if (idx === -1) continue;
    const target = byAddress[remaining[idx].address];
    if (target) {
      await prisma.poolLoanEntry.update({ where: { id: entry.id }, data: { houseId: target.id } });
    }
    remaining.splice(idx, 1);
  }

  const [members, contribs, houses, loanEntries, totalRow] = await Promise.all([
    prisma.poolMember.count({ where: { poolId: pool.id } }),
    prisma.poolContribution.count({ where: { member: { poolId: pool.id } } }),
    prisma.poolHouse.count({ where: { poolId: pool.id } }),
    prisma.poolLoanEntry.count({ where: { loanId: loan.id } }),
    prisma.poolContribution.aggregate({ where: { member: { poolId: pool.id } }, _sum: { amount: true } }),
  ]);
  console.log(
    `VHP-I: members=${members} contribs=${contribs} (total ${totalRow._sum.amount}) houses=${houses} loanEntries=${loanEntries}`,
  );
}

main().finally(() => prisma.$disconnect());
