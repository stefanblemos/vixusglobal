import Link from "next/link";
import { prisma } from "@/lib/db";
import { SimulationForm } from "@/components/simulation-form";

export const dynamic = "force-dynamic";

export default async function NewSimulationPage() {
  const [locations, modelLocations, scenarios, banks, pools] = await Promise.all([
    prisma.catalogLocation.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.catalogModelLocation.findMany({ include: { model: true } }),
    prisma.bufferScenario.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
    prisma.bankProfile.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.investmentPool.findMany({
      where: { status: { in: ["FUNDING", "ACTIVE"] } },
      orderBy: { code: "asc" },
      select: { id: true, code: true, name: true },
    }),
  ]);

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <Link href="/pools/simulator" className="text-sm text-slate-500 hover:text-slate-700">
          ← Simulator
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">New simulation</h1>
        <p className="text-sm text-slate-500">
          Pick the houses, the funding mode and the scenario — the engine builds the dated ledger
          and the investor KPIs.
        </p>
      </div>
      <SimulationForm
        catalog={{
          locations,
          modelLocations: modelLocations.map((ml) => ({
            locationId: ml.locationId,
            modelId: ml.modelId,
            modelName: ml.model.name,
            salePrice: Number(ml.salePrice),
            costPerformance: ml.costPerformance == null ? null : Number(ml.costPerformance),
            costContractor: ml.costContractor == null ? null : Number(ml.costContractor),
            costOpenBook: ml.costOpenBook == null ? null : Number(ml.costOpenBook),
          })),
          scenarios,
          banks,
          pools,
        }}
      />
    </div>
  );
}
