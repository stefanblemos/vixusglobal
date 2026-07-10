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
  // Builders Capital — termos extraídos do transaction history real (loan 77959, Vixus 8 SFR):
  // 9% a.a. sobre o sacado, orig 1,75% + broker 1% + title 1,33%, reserve 6 meses financiada,
  // $20 processing + $185 inspection por draw, $20 ACH por lote, $350 reconveyance por payoff,
  // sweep 85% com quitação na última casa.
  const bc = await prisma.bankProfile.upsert({
    where: { name: "Builders Capital" },
    create: {
      name: "Builders Capital",
      rateType: "FIXED",
      aprPct: 9,
      interestBasis: "DRAWN",
      originationPct: 1.75,
      brokerPct: 1.0,
      titleEscrowPct: 1.33,
      closingFeePct: 0,
      processingFee: 2000,
      budgetReviewFee: 4000,
      appraisalFee: 0,
      legalFee: 2500,
      feesFinanced: true,
      servicingMonthly: 0,
      inspectionFeePerDraw: 185,
      drawProcessingFee: 20,
      achFeePerBatch: 20,
      hasInterestReserve: true,
      reserveMonths: 6,
      releaseMode: "SWEEP_PCT_LAST_FULL",
      sweepPct: 85,
      reconveyanceFee: 350,
      termMonths: 12,
      extensionMonths: 6,
      extensionFeePct: 1,
      notes: "Termos do loan 77959 (Vixus 8 SFR). Extension: >50% devido = 1% sobre todo o financiado.",
    },
    update: {},
  });
  const bcFees = [
    { name: "Credit report", timing: "CLOSING", kind: "FLAT", amount: 71 },
    { name: "Engineering review", timing: "CLOSING", kind: "FLAT", amount: 2000 },
    { name: "Flood determination", timing: "CLOSING", kind: "FLAT", amount: 160 },
    { name: "UCC filing", timing: "CLOSING", kind: "FLAT", amount: 200 },
    { name: "LO credit", timing: "CLOSING", kind: "FLAT", amount: -7000 },
  ];
  const existingFees = await prisma.bankCustomFee.count({ where: { bankProfileId: bc.id } });
  if (existingFees === 0) {
    for (const f of bcFees) {
      await prisma.bankCustomFee.create({ data: { bankProfileId: bc.id, ...f } });
    }
  }
  // RBI (ex-"RDI") e 2BTrust — esqueletos para preencher quando os primeiros projetos
  // fecharem. NÃO recriar "RDI": foi renomeado p/ RBI Private Lending pelo fix-rbi-loi;
  // recriar ressuscitava o esqueleto e o rename seguinte quebrava com P2002.
  for (const name of ["RBI Private Lending", "2BTrust"]) {
    await prisma.bankProfile.upsert({
      where: { name },
      create: { name, notes: "Preencher com os termos reais no primeiro projeto fechado." },
      update: {},
    });
  }
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
