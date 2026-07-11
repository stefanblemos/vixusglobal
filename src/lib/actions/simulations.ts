"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { simulate } from "@/lib/pools/simulator";
import {
  buildSimInput,
  type PromoteTierInput,
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
      .map((u) => ({ locationId: u.locationId, modelId: u.modelId }));
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
    parallelPermit: formData.get("parallelPermit") === "on",
    unitGapDays: Number(formData.get("unitGapDays") ?? 3) || 3,
    scenarioCode: String(formData.get("scenarioCode") ?? "REAL"),
    bankProfileId: String(formData.get("bankProfileId") ?? "").trim() || null,
    poolId: String(formData.get("poolId") ?? "").trim() || null,
    units,
  };
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
      paymentPlan: sim.paymentPlan as "STANDARD" | "LIGHT_START",
      equityGatePct: sim.equityGatePct,
      parallelPermit: sim.parallelPermit,
      unitGapDays: sim.unitGapDays,
      scenarioCode: sim.scenarioCode,
      bankProfileId: sim.fundingMode === "BANK" ? sim.bankProfileId : null,
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
  const paymentPlan =
    String(formData.get("paymentPlan") ?? "") === "LIGHT_START" ? "LIGHT_START" : "STANDARD";
  const upfrontFunding = String(formData.get("upfrontFunding") ?? "") === "on";
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
    parallelPermit: sim.parallelPermit,
    unitGapDays: sim.unitGapDays,
    scenarioCode,
    bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
  };
  const input = await buildSimInput(fields);
  if ("error" in input) return { error: input.error };
  const result = simulate(input);
  await prisma.poolSimulation.update({
    where: { id },
    data: {
      scenarioCode,
      fundingMode: fundingMode as SimFundingMode,
      bankProfileId,
      compMode: compMode as BuilderCompMode,
      perfPct,
      perfTiming,
      flatFeePerHouse,
      paymentPlan: paymentPlan as "STANDARD" | "LIGHT_START",
      upfrontFunding,
      promoteTiers: promoteTiers ?? Prisma.DbNull,
      result: JSON.parse(JSON.stringify(result)),
    },
  });
  revalidatePath(`/pools/simulator/${id}`);
  return undefined;
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
    parallelPermit: sim.parallelPermit,
    unitGapDays: sim.unitGapDays,
    scenarioCode: sim.scenarioCode,
    bankProfileId: sim.bankProfileId,
    units: (sim.units as UnitRef[]) ?? [],
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
  parallelPermit: boolean;
  unitGapDays: number;
  scenarioCode: string;
  units: unknown;
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
    parallelPermit: sim.parallelPermit,
    unitGapDays: sim.unitGapDays,
    scenarioCode: sim.scenarioCode,
    units: (sim.units as UnitRef[]) ?? [],
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
    const bank = await prisma.bankProfile.findUnique({ where: { id: bankId }, select: { name: true } });
    rows.push({
      bankId,
      bankName: bank?.name ?? "?",
      irr: r.kpis.irrAnnual,
      profit: r.kpis.profit,
      peak: r.kpis.totalInvested,
      ctc: r.kpis.cashToClosing ?? 0,
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
