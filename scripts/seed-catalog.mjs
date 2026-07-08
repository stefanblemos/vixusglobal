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

// Valores POR local: sale + costPerformance (perfCost do mock). costContractor (custo-base
// sem o fee do tipo) fica null — preenchido pelo usuário no catálogo. Fee vem do TIPO.
const MODELS = [
  { name: "Arpoador", houseType: "MID_RANGE", buildMonths: 4, values: { "Marion Oaks": { sale: 310000, perf: 202000 } } },
  { name: "Grumari", houseType: "MID_RANGE", buildMonths: 4, values: { "Marion Oaks": { sale: 349000, perf: 212000 } } },
  { name: "Ilhabela", houseType: "AFFORDABLE", buildMonths: 4, values: { Citrus: { sale: 269000, perf: 198000 }, "Rainbow Lakes": { sale: 280000, perf: 198000 } } },
  { name: "Ubatuba", houseType: "AFFORDABLE", buildMonths: 4, values: { Citrus: { sale: 274000, perf: 198000 }, "Rainbow Lakes": { sale: 290000, perf: 198000 } } },
  { name: "Maragogi", houseType: "UPPER_MIDDLE", buildMonths: 4, values: { "Rolling Hills": { sale: 485000, perf: 305000 } } },
  { name: "Vivada", houseType: "LUXURY", buildMonths: 8, values: { Orlando: { sale: 1680000, perf: 760000 } } },
  { name: "Copacabana", houseType: "MID_RANGE", buildMonths: 6, values: { "Port Charlotte": { sale: 359000, perf: 282000 } } },
  { name: "Leblon", houseType: "MID_RANGE", buildMonths: 6, values: { "Port Charlotte": { sale: 345000, perf: 257000 } } },
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
  // Locais/modelos são CREATE-ONLY: o seed cria o que faltar e nunca sobrescreve valores
  // ajustados pela tela (que têm trilha de auditoria em CatalogChangeLog).
  const locByName = {};
  for (const l of LOCATIONS) {
    const row = await prisma.catalogLocation.upsert({ where: { name: l.name }, create: l, update: {} });
    locByName[l.name] = row.id;
  }
  for (const m of MODELS) {
    const { values, ...data } = m;
    const row = await prisma.catalogModel.upsert({ where: { name: m.name }, create: data, update: {} });
    for (const [locName, v] of Object.entries(values)) {
      const locationId = locByName[locName];
      await prisma.catalogModelLocation.upsert({
        where: { modelId_locationId: { modelId: row.id, locationId } },
        create: { modelId: row.id, locationId, salePrice: v.sale, costPerformance: v.perf },
        update: {},
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
