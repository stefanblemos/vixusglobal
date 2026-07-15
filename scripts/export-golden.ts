// Exporta os GOLDEN TESTS do pacote standalone: SimInputs reais congelados + resultado
// esperado (kpis + eventos, 2dp) — o contrato de fidelidade da migração p/ a 4U.
// Rodar contra o espelho de produção:
//   DATABASE_URL="<prodcopy>" npx tsx scripts/export-golden.ts
import fs from "node:fs";
import path from "node:path";
import { prisma } from "../src/lib/db";
import { simulate, type SimInput } from "../src/lib/pools/simulator";
import { buildSimInput, type PromoteTierInput, type SimOverrides, type UnitRef } from "../src/lib/pools/build-sim-input";

const r2 = (v: number) => Math.round(v * 100) / 100;

function expectedOf(input: SimInput) {
  const r = simulate(input);
  const kpis: Record<string, number | null> = {};
  for (const [k, v] of Object.entries(r.kpis)) kpis[k] = typeof v === "number" ? v : v;
  return {
    kpis,
    events: r.events.map((e) => ({ day: e.day, kind: e.kind, amount: r2(e.amount), cash: r2(e.cash) })),
  };
}

async function fieldsOf(namePart: string) {
  const sim = await prisma.poolSimulation.findFirst({
    where: { name: { contains: namePart, mode: "insensitive" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!sim) throw new Error(`Simulação "${namePart}" não encontrada.`);
  return {
    sim,
    fields: {
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
      bankProfileId: sim.bankProfileId,
      units: (sim.units as UnitRef[]) ?? [],
      overrides: (sim.overrides as SimOverrides | null) ?? null,
      vehicleStructure: sim.vehicleStructure,
    },
  };
}

const SCEN_NAMES: Record<string, string> = { OPT: "Ótimo", REAL: "Real", CONS: "Conservador" };

async function main() {
  const outDir = path.join(import.meta.dirname, "..", "standalone", "tests", "golden");
  fs.mkdirSync(outDir, { recursive: true });
  for (const f of fs.readdirSync(outDir)) fs.unlinkSync(path.join(outDir, f));

  // Casos reais: PH7 (equity casa única, waterfall, veículo) nos 3 cenários — também
  // alimentam o exemplo do report; PH-6 (banco); PH6-R01 (24 casas, 4 ciclos)
  const cases: Array<{ file: string; name: string; namePart: string; scenarioCode: string; mutate?: (f: Record<string, unknown>) => void }> = [
    { file: "ph7-real.json", name: "PH7 · equity · Cenário Real", namePart: "PH7", scenarioCode: "REAL" },
    { file: "ph7-cons.json", name: "PH7 · equity · Conservador", namePart: "PH7", scenarioCode: "CONS" },
    { file: "ph7-opt.json", name: "PH7 · equity · Ótimo", namePart: "PH7", scenarioCode: "OPT" },
    { file: "ph6-bank-real.json", name: "PH-6 · banco · Real", namePart: "PH-6", scenarioCode: "REAL" },
    { file: "ph6r01-cycles-real.json", name: "PH6-R01 · 24 casas, 4 ciclos · Real", namePart: "PH6-R01", scenarioCode: "REAL" },
    {
      file: "ph7-openbook-partner-client.json",
      name: "PH7 variante · open book + plano PARTNER + entidade do cliente",
      namePart: "PH7",
      scenarioCode: "REAL",
      mutate: (f) => {
        f.compMode = "OPEN_BOOK";
        f.flatFeePerHouse = 30000;
        f.paymentPlan = "PARTNER";
        f.vehicleStructure = "CLIENT_ENTITY";
      },
    },
  ];

  for (const c of cases) {
    const { fields } = await fieldsOf(c.namePart);
    const f = { ...fields } as Record<string, unknown>;
    c.mutate?.(f);
    const input = await buildSimInput({ ...(f as typeof fields), scenarioCode: c.scenarioCode });
    if ("error" in input) throw new Error(`${c.name}: ${input.error}`);
    const expected = expectedOf(input);
    fs.writeFileSync(
      path.join(outDir, c.file),
      JSON.stringify(
        {
          name: c.name,
          scenarioCode: c.scenarioCode,
          scenarioName: SCEN_NAMES[c.scenarioCode] ?? c.scenarioCode,
          input,
          expected,
        },
        null,
        1,
      ) + "\n",
    );
    console.log(
      `${c.file}: ${expected.events.length} eventos · TIR ${expected.kpis.irrAnnual == null ? "—" : ((expected.kpis.irrAnnual as number) * 100).toFixed(1) + "%"} · lucro $${Math.round(expected.kpis.profit as number).toLocaleString("en-US")}`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
