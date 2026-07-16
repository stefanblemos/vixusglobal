"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { simulate } from "@/lib/pools/simulator";
import {
  buildSimInput,
  countOverrides,
  type PromoteTierInput,
  type SimOverrides,
  type UnitRef,
} from "@/lib/pools/build-sim-input";
import { Prisma, type BuilderCompMode, type SimFundingMode } from "@prisma/client";

export type FormState = { error?: string } | undefined;

function parsePromoteTiers(raw: string): PromoteTierInput[] | null {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const tiers = arr
      .map((t) => ({
        hurdlePct: t.hurdlePct == null || t.hurdlePct === "" ? null : Number(t.hurdlePct),
        promotePct: Number(t.promotePct),
      }))
      .filter((t) => Number.isFinite(t.promotePct) && (t.hurdlePct == null || Number.isFinite(t.hurdlePct)));
    return tiers.length > 0 ? tiers : null;
  } catch {
    return null;
  }
}

function parseUnits(raw: string): UnitRef[] {
  try {
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((u) => u && typeof u.locationId === "string" && typeof u.modelId === "string")
      .map((u) => ({
        locationId: u.locationId,
        modelId: u.modelId,
        cycle: Math.max(1, Math.round(Number(u.cycle ?? 1)) || 1),
      }));
  } catch {
    return [];
  }
}

export async function createSimulation(_prev: FormState, formData: FormData): Promise<FormState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Name is required." };
  const units = parseUnits(String(formData.get("units") ?? "[]"));
  if (units.length === 0) return { error: "Add at least one house." };

  const sim = {
    fundingMode: String(formData.get("fundingMode") ?? "BANK"),
    compMode: String(formData.get("compMode") ?? "PERFORMANCE"),
    perfPct: Number(formData.get("perfPct") ?? 35),
    perfTiming: String(formData.get("perfTiming") ?? "PROJECT_COMPLETION"),
    promoteTiers: parsePromoteTiers(String(formData.get("promoteTiers") ?? "")),
    flatFeePerHouse:
      Number(String(formData.get("flatFeePerHouse") ?? "0").replace(/,/g, "")) || 0,
    paymentPlan: String(formData.get("paymentPlan") ?? "STANDARD"),
    equityGatePct: Number(formData.get("equityGatePct") ?? 10),
    unitGapDays: Number(formData.get("unitGapDays") ?? 3) || 3,
    scenarioCode: String(formData.get("scenarioCode") ?? "REAL"),
    bankProfileId: String(formData.get("bankProfileId") ?? "").trim() || null,
    poolId: String(formData.get("poolId") ?? "").trim() || null,
    units,
  };
  const vehicleStructure =
    String(formData.get("vehicleStructure") ?? "") === "CLIENT_ENTITY" ? "CLIENT_ENTITY" : "VIXUS_MANAGED";
  const clientEntityName = String(formData.get("clientEntityName") ?? "").trim() || null;
  (sim as Record<string, unknown>).vehicleStructure = vehicleStructure;
  if (sim.compMode === "PROMOTE" && !sim.promoteTiers)
    return { error: "Defina pelo menos um tier do promote." };
  const input = await buildSimInput(sim);
  if ("error" in input) return { error: input.error };
  const result = simulate(input);

  const row = await prisma.poolSimulation.create({
    data: {
      name,
      poolId: sim.poolId,
      fundingMode: sim.fundingMode as SimFundingMode,
      compMode: sim.compMode as BuilderCompMode,
      perfPct: sim.perfPct,
      perfTiming: sim.perfTiming,
      promoteTiers: sim.promoteTiers ?? undefined,
      flatFeePerHouse: sim.flatFeePerHouse,
      paymentPlan: sim.paymentPlan as "STANDARD" | "LIGHT_START" | "PARTNER",
      equityGatePct: sim.equityGatePct,
      unitGapDays: sim.unitGapDays,
      scenarioCode: sim.scenarioCode,
      bankProfileId: sim.fundingMode === "BANK" ? sim.bankProfileId : null,
      vehicleStructure,
      clientEntityName: vehicleStructure === "CLIENT_ENTITY" ? clientEntityName : null,
      units: units as object[],
      result: JSON.parse(JSON.stringify(result)),
    },
  });
  revalidatePath("/pools/simulator");
  redirect(`/pools/simulator/${row.id}`);
}

// Alavancas da tela de resultado: cenário, funding e remuneração são ajustáveis na hora —
// a simulação é "viva" (sobrescreve o snapshot; sem histórico, decisão do Stefan). A
// comparação de bancos é descartada porque foi calculada sob as premissas antigas.
// Erros de catálogo (ex.: custo open book não preenchido no modelo) VOLTAM para a tela —
// antes a action desistia em silêncio e parecia que a escolha "não persistia".
export async function updateSimulationSettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("simulationId") ?? "");
  if (!id) return { error: "Simulation not found." };
  const sim = await prisma.poolSimulation.findUnique({ where: { id } });
  if (!sim) return { error: "Simulation not found." };

  const scenarioCode = String(formData.get("scenarioCode") ?? sim.scenarioCode);
  const fundingMode = String(formData.get("fundingMode") ?? sim.fundingMode);
  const bankProfileId =
    fundingMode === "BANK"
      ? String(formData.get("bankProfileId") ?? "").trim() || sim.bankProfileId
      : null;
  const compMode = String(formData.get("compMode") ?? sim.compMode);
  const perfPctRaw = Number(String(formData.get("perfPct") ?? "").replace(/,/g, ""));
  const perfPct = Number.isFinite(perfPctRaw) && perfPctRaw > 0 ? perfPctRaw : Number(sim.perfPct);
  const perfTiming = String(formData.get("perfTiming") ?? sim.perfTiming);
  const flatRaw = Number(String(formData.get("flatFeePerHouse") ?? "").replace(/,/g, ""));
  const flatFeePerHouse = Number.isFinite(flatRaw) && flatRaw >= 0 ? flatRaw : Number(sim.flatFeePerHouse);
  const planRaw = String(formData.get("paymentPlan") ?? "");
  const paymentPlan =
    planRaw === "LIGHT_START" || planRaw === "PARTNER" ? planRaw : "STANDARD";
  const upfrontFunding = String(formData.get("upfrontFunding") ?? "") === "on";
  const vsRaw = String(formData.get("vehicleStructure") ?? "");
  const vehicleStructure =
    vsRaw === "CLIENT_ENTITY" || vsRaw === "VIXUS_MANAGED" ? vsRaw : sim.vehicleStructure;
  const clientEntityName =
    formData.get("clientEntityName") != null
      ? String(formData.get("clientEntityName")).trim() || null
      : sim.clientEntityName;
  // waiver do custo de abertura — QUALQUER estrutura (16/07: até a PH6 o veículo é a
  // própria Vixus, sem LLC nova; a regra da entidade dedicada só começa na PH7)
  const waiveFormationCost = String(formData.get("waiveFormationCost") ?? "") === "on";
  // nome do projeto (renomeável — 15/07) e nome da LLC dedicada (capa do report)
  const newName =
    formData.get("name") != null ? String(formData.get("name")).trim() || sim.name : sim.name;
  const vehicleEntityName =
    formData.get("vehicleEntityName") != null
      ? String(formData.get("vehicleEntityName")).trim() || null
      : sim.vehicleEntityName;
  // Waterfall é OPT-IN: os controles mandam os tiers só quando ativos (PROMOTE sempre;
  // open book só com o checkbox marcado). Vazio = sem waterfall.
  const tiersField = formData.get("promoteTiers");
  const promoteTiers =
    typeof tiersField === "string"
      ? parsePromoteTiers(tiersField)
      : ((sim.promoteTiers as PromoteTierInput[] | null) ?? null);
  if (compMode === "PROMOTE" && !promoteTiers)
    return { error: "Defina pelo menos um tier do promote." };

  const fields = {
    fundingMode,
    upfrontFunding,
    compMode,
    perfPct,
    perfTiming,
    promoteTiers,
    flatFeePerHouse,
    paymentPlan,
    equityGatePct: sim.equityGatePct,
    unitGapDays: sim.unitGapDays,
    scenarioCode,
    bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
    overrides: (sim.overrides as SimOverrides | null) ?? null,
    vehicleStructure,
    waiveFormationCost,
  };
  const input = await buildSimInput(fields);
  if ("error" in input) return { error: input.error };
  const result = simulate(input);
  await prisma.poolSimulation.update({
    where: { id },
    data: {
      name: newName,
      scenarioCode,
      fundingMode: fundingMode as SimFundingMode,
      bankProfileId,
      compMode: compMode as BuilderCompMode,
      perfPct,
      perfTiming,
      flatFeePerHouse,
      paymentPlan: paymentPlan as "STANDARD" | "LIGHT_START" | "PARTNER",
      upfrontFunding,
      vehicleStructure,
      clientEntityName: vehicleStructure === "CLIENT_ENTITY" ? clientEntityName : null,
      vehicleEntityName: vehicleStructure === "VIXUS_MANAGED" ? vehicleEntityName : null,
      waiveFormationCost,
      promoteTiers: promoteTiers ?? Prisma.DbNull,
      result: JSON.parse(JSON.stringify(result)),
    },
  });
  revalidatePath(`/pools/simulator/${id}`);
  return undefined;
}

// Edita a CESTA (casas + ciclos) de uma simulação existente — a simulação é viva:
// valida no catálogo, re-roda o motor e sobrescreve o snapshot. Erros voltam visíveis
// (React 19: nunca return silencioso em form de edição).
export async function updateSimulationUnits(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("simulationId") ?? "");
  if (!id) return { error: "Simulation not found." };
  const sim = await prisma.poolSimulation.findUnique({ where: { id } });
  if (!sim) return { error: "Simulation not found." };
  const units = parseUnits(String(formData.get("units") ?? "[]"));
  if (units.length === 0) return { error: "A cesta precisa de pelo menos uma casa." };

  const input = await buildSimInput({
    fundingMode: sim.fundingMode,
    upfrontFunding: sim.upfrontFunding,
    compMode: sim.compMode,
    perfPct: sim.perfPct,
    perfTiming: sim.perfTiming,
    promoteTiers: (sim.promoteTiers as PromoteTierInput[] | null) ?? null,
    flatFeePerHouse: sim.flatFeePerHouse,
    paymentPlan: sim.paymentPlan,
    equityGatePct: sim.equityGatePct,
    unitGapDays: sim.unitGapDays,
    scenarioCode: sim.scenarioCode,
    bankProfileId: sim.bankProfileId,
    units,
    overrides: (sim.overrides as SimOverrides | null) ?? null,
    vehicleStructure: sim.vehicleStructure,
    waiveFormationCost: sim.waiveFormationCost,
  });
  if ("error" in input) return { error: input.error };
  const result = simulate(input);
  await prisma.poolSimulation.update({
    where: { id },
    data: { units: units as object[], result: JSON.parse(JSON.stringify(result)) },
  });
  revalidatePath(`/pools/simulator/${id}`);
  return undefined;
}

// Aba Premissas: salva os overrides da simulação. O componente manda os valores DIGITADOS
// (cópia pré-preenchida); aqui normalizamos — valor igual ao catálogo atual NÃO vira
// override (campo não tocado continua seguindo o catálogo). Re-roda o motor na hora.
export async function updateSimulationOverrides(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const id = String(formData.get("simulationId") ?? "");
  if (!id) return { error: "Simulation not found." };
  const sim = await prisma.poolSimulation.findUnique({ where: { id } });
  if (!sim) return { error: "Simulation not found." };

  let raw: SimOverrides;
  try {
    raw = JSON.parse(String(formData.get("overrides") ?? "{}"));
  } catch {
    return { error: "Premissas inválidas." };
  }

  // Normalização contra o catálogo ATUAL: só diverge = override; inválido/vazio = fora
  const clean: SimOverrides = { locations: {}, combos: {} };
  const num = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  for (const [locId, o] of Object.entries(raw.locations ?? {})) {
    const loc = await prisma.catalogLocation.findUnique({ where: { id: locId } });
    if (!loc) continue;
    const entry: Record<string, number> = {};
    const lot = num(o.lotCost);
    if (lot != null && lot !== Number(loc.lotCostEstimate ?? NaN)) entry.lotCost = lot;
    for (const [k, cat] of [
      ["lotLeadDays", loc.lotLeadDays],
      ["permitDays", loc.permitDays],
      ["saleDays", loc.saleDays],
    ] as const) {
      const v = num((o as Record<string, unknown>)[k]);
      if (v != null && Math.round(v) !== cat) entry[k] = Math.round(v);
    }
    if (Object.keys(entry).length) clean.locations![locId] = entry;
  }
  for (const [key, o] of Object.entries(raw.combos ?? {})) {
    const [modelId, locationId] = key.split("|");
    const ml = await prisma.catalogModelLocation.findUnique({
      where: { modelId_locationId: { modelId, locationId } },
      include: { model: true },
    });
    if (!ml) continue;
    const fees = new Map(
      (await prisma.houseTypeFee.findMany()).map((f) => [f.type as string, Number(f.fee)]),
    );
    const catFee = Number(ml.model.contractorFee ?? fees.get(ml.model.houseType) ?? 0);
    const entry: Record<string, number> = {};
    for (const [k, cat] of [
      ["salePrice", Number(ml.salePrice)],
      ["costPerformance", ml.costPerformance == null ? null : Number(ml.costPerformance)],
      ["costContractor", ml.costContractor == null ? null : Number(ml.costContractor)],
      ["costOpenBook", ml.costOpenBook == null ? null : Number(ml.costOpenBook)],
      ["contractorFee", catFee],
      ["buildMonths", Number(ml.model.buildMonths)],
    ] as const) {
      const v = num((o as Record<string, unknown>)[k]);
      if (v != null && v !== cat) entry[k] = v;
    }
    if (Object.keys(entry).length) clean.combos![key] = entry;
  }
  // Grade de cenário (3 colunas): normaliza contra os valores ATUAIS de cada cenário
  clean.scenarios = {};
  const SCEN_FIELDS = [
    "salePriceBufferPct",
    "constructionCostBufferPct",
    "lotCostBufferPct",
    "closingFeePct",
    "contingencyReservePct",
    "landAcquisitionDays",
    "saleClosingDays",
    "constructionDurationBufferM",
    "salesAbsorptionMonths",
    "emdPct",
    "unitGapDays",
  ] as const;
  for (const [code, o] of Object.entries(raw.scenarios ?? {})) {
    const sc = await prisma.bufferScenario.findUnique({ where: { code } });
    if (!sc) continue;
    const cat: Record<string, number | null> = {
      salePriceBufferPct: Number(sc.salePriceBufferPct),
      constructionCostBufferPct: Number(sc.constructionCostBufferPct),
      lotCostBufferPct: Number(sc.lotCostBufferPct),
      closingFeePct: Number(sc.closingFeePct),
      contingencyReservePct: Number(sc.contingencyReservePct),
      landAcquisitionDays: sc.landAcquisitionDays,
      saleClosingDays: sc.saleClosingDays,
      constructionDurationBufferM: Number(sc.constructionDurationBufferM),
      salesAbsorptionMonths: sc.salesAbsorptionMonths == null ? null : Number(sc.salesAbsorptionMonths),
      emdPct: Number(sc.emdPct),
      unitGapDays: sc.unitGapDays,
    };
    const entry: Record<string, number> = {};
    for (const k of SCEN_FIELDS) {
      const rawV = (o as Record<string, unknown>)[k];
      // buffers podem ser NEGATIVOS (−5% de venda, −0.5m de prazo) — só valida finito
      const v = rawV === "" || rawV == null ? null : Number(rawV);
      if (v != null && Number.isFinite(v) && v !== cat[k]) entry[k] = v;
    }
    if (Object.keys(entry).length) clean.scenarios[code] = entry;
  }

  // Custos do veículo: valor ≠ catálogo vira override (mesma regra dos demais)
  clean.vehicleCosts = {};
  for (const [costId, v] of Object.entries(raw.vehicleCosts ?? {})) {
    const cost = await prisma.catalogVehicleCost.findUnique({ where: { id: costId } });
    if (!cost) continue;
    const nV = Number(v);
    if (Number.isFinite(nV) && nV >= 0 && nV !== Number(cost.amount)) clean.vehicleCosts[costId] = nV;
  }

  const overrides = countOverrides(clean) > 0 ? clean : null;

  const input = await buildSimInput({
    fundingMode: sim.fundingMode,
    upfrontFunding: sim.upfrontFunding,
    compMode: sim.compMode,
    perfPct: sim.perfPct,
    perfTiming: sim.perfTiming,
    promoteTiers: (sim.promoteTiers as PromoteTierInput[] | null) ?? null,
    flatFeePerHouse: sim.flatFeePerHouse,
    paymentPlan: sim.paymentPlan,
    equityGatePct: sim.equityGatePct,
    unitGapDays: sim.unitGapDays,
    scenarioCode: sim.scenarioCode,
    bankProfileId: sim.bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
    overrides,
  });
  if ("error" in input) return { error: input.error };
  const result = simulate(input);
  await prisma.poolSimulation.update({
    where: { id },
    data: {
      overrides: overrides === null ? Prisma.DbNull : (overrides as object),
      result: JSON.parse(JSON.stringify(result)),
    },
  });
  revalidatePath(`/pools/simulator/${id}`);
  return undefined;
}

// Duplica a simulação (a original é "viva" e sobrescreve — duplicar é como se guarda
// uma versão). Copia premissas + cesta + snapshot; sem vínculo com pool.
export async function duplicateSimulation(formData: FormData): Promise<void> {
  const id = String(formData.get("simulationId") ?? "");
  if (!id) return;
  const sim = await prisma.poolSimulation.findUnique({ where: { id } });
  if (!sim) return;
  const copy = await prisma.poolSimulation.create({
    data: {
      name: `${sim.name} (cópia)`,
      fundingMode: sim.fundingMode,
      compMode: sim.compMode,
      perfPct: sim.perfPct,
      perfTiming: sim.perfTiming,
      promoteTiers: sim.promoteTiers ?? undefined,
      flatFeePerHouse: sim.flatFeePerHouse,
      paymentPlan: sim.paymentPlan,
      upfrontFunding: sim.upfrontFunding,
      equityGatePct: sim.equityGatePct,
      unitGapDays: sim.unitGapDays,
      scenarioCode: sim.scenarioCode,
      bankProfileId: sim.bankProfileId,
      vehicleStructure: sim.vehicleStructure,
      waiveFormationCost: sim.waiveFormationCost,
      clientEntityName: sim.clientEntityName,
      units: (sim.units as object[]) ?? [],
      overrides: sim.overrides ?? undefined,
      result: sim.result ?? undefined,
    },
  });
  revalidatePath("/pools/simulator");
  redirect(`/pools/simulator/${copy.id}`);
}

// Reexecuta com os catálogos/cenário atuais e re-grava o snapshot.
export async function rerunSimulation(formData: FormData): Promise<void> {
  const id = String(formData.get("simulationId") ?? "");
  if (!id) return;
  const sim = await prisma.poolSimulation.findUnique({ where: { id } });
  if (!sim) return;
  const input = await buildSimInput({
    fundingMode: sim.fundingMode,
    upfrontFunding: sim.upfrontFunding,
    compMode: sim.compMode,
    perfPct: sim.perfPct,
    perfTiming: sim.perfTiming,
    promoteTiers: (sim.promoteTiers as PromoteTierInput[] | null) ?? null,
    flatFeePerHouse: sim.flatFeePerHouse,
    paymentPlan: sim.paymentPlan,
    equityGatePct: sim.equityGatePct,
    unitGapDays: sim.unitGapDays,
    scenarioCode: sim.scenarioCode,
    bankProfileId: sim.bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
    overrides: (sim.overrides as SimOverrides | null) ?? null,
    vehicleStructure: sim.vehicleStructure,
    waiveFormationCost: sim.waiveFormationCost,
  });
  if ("error" in input) return;
  const result = simulate(input);
  await prisma.poolSimulation.update({
    where: { id },
    data: { result: JSON.parse(JSON.stringify(result)) },
  });
  revalidatePath(`/pools/simulator/${id}`);
}

// Converte a simulação aprovada num pool real: casas nascem com o pro forma do CENÁRIO
// (lote/obra/venda/closing ajustados), profit share e meta herdados; se for loan, o
// PoolLoan já nasce com o banco e o comprometido estimado. Daí é ajuste sobre o simulado.
export async function convertSimulationToPool(formData: FormData): Promise<void> {
  const id = String(formData.get("simulationId") ?? "");
  if (!id) return;
  const sim = await prisma.poolSimulation.findUnique({
    where: { id },
    include: { scenario: true, bankProfile: true },
  });
  if (!sim || sim.poolId) return; // inexistente ou já convertida
  const result = sim.result as {
    kpis?: { totalInvested?: number; bankCommitted?: number };
    units?: Array<{ label: string; salePrice: number; adjLot: number; adjBuild: number; adjSaleNet: number; bankEligible?: number }>;
  } | null;
  if (!result?.units?.length) return; // rode a simulação antes

  const count = await prisma.investmentPool.count();
  const { roman } = await import("@/lib/pools/math");
  const code = `VHP-${roman(count + 1)}`;

  const saleBuffer = Number(sim.scenario.salePriceBufferPct) / 100;
  const round2 = (v: number) => Math.round(v * 100) / 100;

  const pool = await prisma.investmentPool.create({
    data: {
      code,
      name: `Vixus Home Partners ${roman(count + 1)} LLC`,
      alias: sim.name,
      status: "FUNDING",
      targetAmount: result.kpis?.totalInvested ?? null,
      profitSharePct: sim.compMode === "PERFORMANCE" ? Number(sim.perfPct) / 100 : null,
      profitShareTiming: sim.compMode === "PERFORMANCE" ? "PROJECT_COMPLETION" : null,
      notes: `Criado da simulação "${sim.name}" (cenário ${sim.scenario.name}, ${sim.fundingMode === "BANK" ? `loan ${sim.bankProfile?.name ?? ""}` : "equity"}).`,
      houses: {
        create: result.units.map((u, i) => {
          const gross = round2(u.salePrice * (1 + saleBuffer));
          const unitRef = (sim.units as Array<{ locationId?: string; modelId?: string }>)[i];
          return {
            address: `Casa ${i + 1} — ${u.label} (endereço a definir)`,
            status: "PLANNED" as const,
            // modelo/localização de origem: a casa carrega o vínculo do simulador
            catalogModelId: unitRef?.modelId ?? null,
            catalogLocationId: unitRef?.locationId ?? null,
            plannedLotCost: u.adjLot,
            plannedBuildCost: u.adjBuild,
            plannedSalePrice: gross,
            plannedClosingCost: round2(gross - u.adjSaleNet),
            // quanto o banco vai financiar NESTA casa (base LTC contractor+fee+lote) —
            // vira o budget de draw; ajustável na ficha se a aprovação final divergir
            ...(sim.fundingMode === "BANK" && (u.bankEligible ?? 0) > 0
              ? { bankLoanAmount: u.bankEligible!, bankName: sim.bankProfile?.name ?? null }
              : {}),
            notes: `Pro forma do cenário ${sim.scenario.name}`,
          };
        }),
      },
    },
  });

  await prisma.poolSimulation.update({ where: { id }, data: { poolId: pool.id } });

  // regra do Stefan (16/07): o pool é SEMPRE iniciado pela própria Vixus — nasce com ela
  // como MANAGER no cap table; os demais sócios entram depois, na janela de Funding
  const vixus = await prisma.company.findFirst({
    where: {
      OR: [
        { legalName: { startsWith: "Vixus America Investments" } },
        { aliases: { has: "Vixus America Investments" } },
      ],
    },
    select: { id: true },
  });
  if (vixus) {
    await prisma.poolMember.create({
      data: { poolId: pool.id, role: "MANAGER", companyId: vixus.id },
    });
  }

  if (sim.fundingMode === "BANK" && sim.bankProfileId) {
    const loan = await prisma.poolLoan.create({
      data: {
        poolId: pool.id,
        bankProfileId: sim.bankProfileId,
        committed: result.kpis?.bankCommitted ?? null,
        notes: `Estimado pela simulação "${sim.name}" — substituir pelo loan real no closing.`,
      },
    });
    // loan principal: todas as casas nascem nele; loans de outros bancos são adicionados
    // manualmente na aba Loan e as casas realocadas na ficha
    await prisma.poolHouse.updateMany({ where: { poolId: pool.id }, data: { loanId: loan.id } });
  }

  revalidatePath("/pools");
  redirect(`/pools/${pool.id}`);
}

type CompareRow = {
  bankId: string;
  bankName: string;
  irr: number | null;
  profit: number;
  peak: number;
  bankCost: number;
  // decomposição do custo (pedido do Stefan 14/07: juros/fees explícitos) + o "porquê"
  // do aporte menor (fees/reserve financiados no loan não saem do caixa do investidor)
  upfront?: number;
  interest?: number;
  otherFees?: number;
  extFee?: number;
  feesFinanced?: boolean;
  reserveFunded?: number;
  ctc?: number;
  best?: boolean;
};

function simFields(sim: {
  fundingMode: string;
  upfrontFunding: boolean;
  compMode: string;
  perfPct: unknown;
  perfTiming: string;
  promoteTiers: unknown;
  flatFeePerHouse: unknown;
  paymentPlan: string;
  equityGatePct: unknown;
  unitGapDays: number;
  scenarioCode: string;
  units: unknown;
  overrides?: unknown;
  vehicleStructure: string;
  waiveFormationCost: boolean;
}) {
  return {
    upfrontFunding: sim.upfrontFunding,
    compMode: sim.compMode,
    perfPct: sim.perfPct,
    perfTiming: sim.perfTiming,
    promoteTiers: (sim.promoteTiers as PromoteTierInput[] | null) ?? null,
    flatFeePerHouse: sim.flatFeePerHouse,
    paymentPlan: sim.paymentPlan,
    equityGatePct: sim.equityGatePct,
    unitGapDays: sim.unitGapDays,
    scenarioCode: sim.scenarioCode,
    units: (sim.units as UnitRef[]) ?? [],
    overrides: (sim.overrides as SimOverrides | null) ?? null,
    vehicleStructure: sim.vehicleStructure,
    waiveFormationCost: sim.waiveFormationCost,
  };
}

// Roda a MESMA simulação para N bancos e marca a melhor opção (maior TIR; lucro desempata).
export async function compareSimulationBanks(formData: FormData): Promise<void> {
  const id = String(formData.get("simulationId") ?? "");
  const bankIds = formData.getAll("bankIds").map(String).filter(Boolean);
  if (!id || bankIds.length === 0) return;
  const sim = await prisma.poolSimulation.findUnique({ where: { id } });
  if (!sim) return;

  const rows: CompareRow[] = [];
  for (const bankId of bankIds) {
    const input = await buildSimInput({ ...simFields(sim), fundingMode: "BANK", bankProfileId: bankId });
    if ("error" in input) continue;
    const r = simulate(input);
    const bank = await prisma.bankProfile.findUnique({
      where: { id: bankId },
      select: { name: true, feesFinanced: true },
    });
    rows.push({
      bankId,
      bankName: bank?.name ?? "?",
      irr: r.kpis.irrAnnual,
      profit: r.kpis.profit,
      peak: r.kpis.totalInvested,
      ctc: r.kpis.cashToClosing ?? 0,
      upfront: Math.round(r.kpis.bankUpfrontFees * 100) / 100,
      interest: Math.round(r.kpis.bankInterestTotal * 100) / 100,
      otherFees: Math.round((r.kpis.bankOtherFees ?? 0) * 100) / 100,
      extFee: Math.round(r.kpis.bankExtensionFee * 100) / 100,
      feesFinanced: bank?.feesFinanced ?? false,
      reserveFunded: Math.round(r.kpis.bankReserveFunded * 100) / 100,
      bankCost:
        Math.round(
          (r.kpis.bankUpfrontFees +
            r.kpis.bankInterestTotal +
            (r.kpis.bankOtherFees ?? 0) +
            r.kpis.bankExtensionFee) *
            100,
        ) / 100,
    });
  }
  rows.sort((a, b) => (b.irr ?? -Infinity) - (a.irr ?? -Infinity) || b.profit - a.profit);
  if (rows[0]) rows[0].best = true;

  const result = (sim.result as Record<string, unknown> | null) ?? {};
  await prisma.poolSimulation.update({
    where: { id },
    data: { result: { ...result, comparison: rows } as never },
  });
  revalidatePath(`/pools/simulator/${id}`);
}

// Adota o banco vencedor: define o perfil na simulação e re-roda (mantendo a comparação).
export async function useComparedBank(formData: FormData): Promise<void> {
  const id = String(formData.get("simulationId") ?? "");
  const bankId = String(formData.get("bankId") ?? "");
  if (!id || !bankId) return;
  const sim = await prisma.poolSimulation.findUnique({ where: { id } });
  if (!sim) return;
  const input = await buildSimInput({ ...simFields(sim), fundingMode: "BANK", bankProfileId: bankId });
  if ("error" in input) return;
  const r = simulate(input);
  const prev = (sim.result as Record<string, unknown> | null) ?? {};
  await prisma.poolSimulation.update({
    where: { id },
    data: {
      fundingMode: "BANK",
      bankProfileId: bankId,
      result: { ...JSON.parse(JSON.stringify(r)), comparison: prev.comparison ?? null } as never,
    },
  });
  revalidatePath(`/pools/simulator/${id}`);
}

export async function deleteSimulation(formData: FormData): Promise<void> {
  const id = String(formData.get("simulationId") ?? "");
  if (id) await prisma.poolSimulation.delete({ where: { id } });
  revalidatePath("/pools/simulator");
  redirect("/pools/simulator");
}
