// Seed dos catálogos do simulador de pools (idempotente — upsert por chave natural).
// Cenários: docx "Investment Thesis Simulator - Buffers". Locais/modelos: mockup v15c
// com o bug de Citrus corrigido (modelo+local agora é chave composta).
// Uso: node scripts/seed-catalog.mjs   (DATABASE_URL do ambiente ou .env)
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SCENARIOS = [
  { code: "OPT", name: "Ótimo", salePriceBufferPct: 5, constructionCostBufferPct: -2, lotCostBufferPct: -1, closingFeePct: 7.5, contingencyReservePct: 3, landAcquisitionDays: 10, constructionDurationBufferM: -1, salesAbsorptionMonths: 1, emdPct: 5, stressSlippagePct: 0, sortOrder: 1 },
  { code: "REAL", name: "Real", salePriceBufferPct: 0, constructionCostBufferPct: 0, lotCostBufferPct: 0, closingFeePct: 8, contingencyReservePct: 5, landAcquisitionDays: 20, constructionDurationBufferM: 0, salesAbsorptionMonths: 2, emdPct: 10, stressSlippagePct: 1, sortOrder: 2 },
  { code: "CONS", name: "Conservador", salePriceBufferPct: -7, constructionCostBufferPct: 10, lotCostBufferPct: 5, closingFeePct: 9, contingencyReservePct: 8, landAcquisitionDays: 30, constructionDurationBufferM: 2, salesAbsorptionMonths: 4, emdPct: 10, stressSlippagePct: 3, sortOrder: 3 },
];

const HOUSE_TYPES = ["AFFORDABLE", "MID_RANGE", "UPPER_MIDDLE", "HIGH_END", "LUXURY", "DUPLEX", "TRIPLEX", "MULTIFAMILY"];

const LOCATIONS = [
  { name: "Marion Oaks", permitDays: 45, lotLeadDays: 30, saleDays: 60, lotCostEstimate: 45000 },
  { name: "Citrus", permitDays: 45, lotLeadDays: 30, saleDays: 60, lotCostEstimate: 25000 },
  { name: "Rolling Hills", permitDays: 45, lotLeadDays: 30, saleDays: 60, lotCostEstimate: 70000 },
  { name: "Rainbow Lakes", permitDays: 45, lotLeadDays: 30, saleDays: 60, lotCostEstimate: 25000 },
  { name: "Orlando", permitDays: 120, lotLeadDays: 60, saleDays: 120, lotCostEstimate: 420000 },
  { name: "Port Charlotte", permitDays: 90, lotLeadDays: 30, saleDays: 30, lotCostEstimate: 25000 },
];

// directCost = perfCost do mock; contractorFee = buildCost − perfCost do mock.
const MODELS = [
  { name: "Arpoador", houseType: "MID_RANGE", buildMonths: 4, directCost: 202000, contractorFee: 8000, sales: { "Marion Oaks": 310000 } },
  { name: "Grumari", houseType: "MID_RANGE", buildMonths: 4, directCost: 212000, contractorFee: 8000, sales: { "Marion Oaks": 349000 } },
  { name: "Ilhabela", houseType: "AFFORDABLE", buildMonths: 4, directCost: 198000, contractorFee: 7000, sales: { Citrus: 269000, "Rainbow Lakes": 280000 } },
  { name: "Ubatuba", houseType: "AFFORDABLE", buildMonths: 4, directCost: 198000, contractorFee: 9000, sales: { Citrus: 274000, "Rainbow Lakes": 290000 } },
  { name: "Maragogi", houseType: "UPPER_MIDDLE", buildMonths: 4, directCost: 305000, contractorFee: 15000, sales: { "Rolling Hills": 485000 } },
  { name: "Vivada", houseType: "LUXURY", buildMonths: 8, directCost: 760000, contractorFee: 20000, sales: { Orlando: 1680000 } },
  { name: "Copacabana", houseType: "MID_RANGE", buildMonths: 6, directCost: 282000, contractorFee: 8000, sales: { "Port Charlotte": 359000 } },
  { name: "Leblon", houseType: "MID_RANGE", buildMonths: 6, directCost: 257000, contractorFee: 8000, sales: { "Port Charlotte": 345000 } },
];

async function main() {
  for (const s of SCENARIOS) {
    await prisma.bufferScenario.upsert({ where: { code: s.code }, create: s, update: s });
  }
  for (const type of HOUSE_TYPES) {
    await prisma.houseTypeFee.upsert({ where: { type }, create: { type, fee: 0 }, update: {} });
  }
  await prisma.bankProfile.upsert({
    where: { name: "Generic construction lender" },
    create: {
      name: "Generic construction lender",
      notes: "Defaults do mockup; ajustar por banco real (LTC 65-85%, LTV 55-70%, prime+1%+).",
    },
    update: {},
  });
  const locByName = {};
  for (const l of LOCATIONS) {
    const row = await prisma.catalogLocation.upsert({ where: { name: l.name }, create: l, update: l });
    locByName[l.name] = row.id;
  }
  for (const m of MODELS) {
    const { sales, ...data } = m;
    const row = await prisma.catalogModel.upsert({ where: { name: m.name }, create: data, update: data });
    for (const [locName, salePrice] of Object.entries(sales)) {
      const locationId = locByName[locName];
      await prisma.catalogModelLocation.upsert({
        where: { modelId_locationId: { modelId: row.id, locationId } },
        create: { modelId: row.id, locationId, salePrice },
        update: { salePrice },
      });
    }
  }
  const counts = await Promise.all([
    prisma.bufferScenario.count(),
    prisma.catalogLocation.count(),
    prisma.catalogModel.count(),
    prisma.catalogModelLocation.count(),
    prisma.bankProfile.count(),
  ]);
  console.log(`scenarios=${counts[0]} locations=${counts[1]} models=${counts[2]} modelLocs=${counts[3]} banks=${counts[4]}`);
}

main().finally(() => prisma.$disconnect());
