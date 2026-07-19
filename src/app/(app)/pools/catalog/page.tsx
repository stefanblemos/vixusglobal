import Link from "next/link";
import { prisma } from "@/lib/db";
import { saveHouseTypeFee } from "@/lib/actions/catalog";
import { CatalogVehicle } from "@/components/catalog-vehicle";
import { CatalogMilestones } from "@/components/catalog-milestones";
import { CatalogScenarios } from "@/components/catalog-scenarios";
import { CatalogBanks } from "@/components/catalog-banks";
import { BankLoiUpload } from "@/components/bank-loi-upload";
import { CatalogLocations, type HistoryEntry } from "@/components/catalog-locations";
import { CatalogModels } from "@/components/catalog-models";
import { HOUSE_TYPES, HOUSE_TYPE_LABEL } from "@/lib/pools/house-types";

export const dynamic = "force-dynamic";

const input =
  "w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-[#1f3a5f]";
const saveBtn =
  "rounded bg-[#1f3a5f] px-3 py-1 text-xs font-medium text-white hover:bg-[#16304f]";
const delBtn = "text-xs text-slate-300 hover:text-red-500";

const TABS = [
  ["locations", "Locations"],
  ["models", "House models"],
  ["fees", "Contractor fees"],
  ["banks", "Bank profiles"],
  ["scenarios", "Scenarios"],
  ["vehicle", "Veículo & waterfall"],
  ["milestones", "Marcos de obra"],
] as const;

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-medium text-slate-800">{title}</h2>
        <p className="text-xs text-slate-400">{hint}</p>
      </div>
      <div className="overflow-x-auto p-4">{children}</div>
    </section>
  );
}

export default async function PoolCatalogPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab: rawTab } = await searchParams;
  const tab = TABS.some(([t]) => t === rawTab) ? (rawTab as string) : "locations";

  const [locations, models, fees, banks, scenarios, changeLog, lois, waterfallTiers, vehicleCosts, buildMilestones] = await Promise.all([
    prisma.catalogLocation.findMany({
      orderBy: { name: "asc" },
      include: { models: { include: { model: true }, orderBy: { model: { name: "asc" } } } },
    }),
    prisma.catalogModel.findMany({
      orderBy: { name: "asc" },
      include: {
        locations: { include: { location: true }, orderBy: { location: { name: "asc" } } },
      },
    }),
    prisma.houseTypeFee.findMany(),
    prisma.bankProfile.findMany({
      orderBy: { name: "asc" },
      include: { customFees: { orderBy: { createdAt: "asc" } } },
    }),
    prisma.bufferScenario.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.catalogChangeLog.findMany({
      where: { entity: { in: ["LOCATION", "MODEL", "SCENARIO", "BANK"] } },
      orderBy: { createdAt: "desc" },
      take: 400,
    }),
    prisma.bankLoi.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        loiNumber: true,
        loiDate: true,
        propertyAddress: true,
        bankProfile: { select: { name: true } },
      },
    }),
    prisma.catalogWaterfallTier.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.catalogVehicleCost.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.catalogBuildMilestone.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const feeByType = new Map(fees.map((f) => [f.type as string, f.fee.toString()]));
  const history = (entity: string): HistoryEntry[] =>
    changeLog
      .filter((h) => h.entity === entity)
      .map((h) => ({
        entityId: h.entityId,
        action: h.action,
        changedBy: h.changedBy,
        createdAt: h.createdAt.toISOString(),
        changes: (h.changes as HistoryEntry["changes"]) ?? [],
      }));

  return (
    <div className="space-y-6">
      <div>
        <Link href="/pools" className="text-sm text-slate-500 hover:text-slate-700">
          ← Pools
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Simulator catalog</h1>
        <p className="text-sm text-slate-500">
          Locations, house models, contractor fees by type, bank profiles and buffer scenarios —
          the assumptions behind every simulation.
        </p>
      </div>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map(([key, label]) => (
          <Link
            key={key}
            href={`/pools/catalog?tab=${key}`}
            className={`rounded-t-lg border-b-2 px-4 py-2 text-sm transition ${
              tab === key
                ? "border-[#1f3a5f] font-medium text-[#1f3a5f]"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </Link>
        ))}
      </div>

      {tab === "locations" && (
        <CatalogLocations
          locations={locations.map((l) => ({
            id: l.id,
            name: l.name,
            permitDays: l.permitDays,
            lotLeadDays: l.lotLeadDays,
            saleDays: l.saleDays,
            lotCostEstimate: l.lotCostEstimate?.toString() ?? null,
            notes: l.notes,
            models: l.models.map((ml) => ({
              name: ml.model.name,
              salePrice: ml.salePrice.toString(),
              costPerformance: ml.costPerformance?.toString() ?? null,
            })),
          }))}
          history={history("LOCATION")}
        />
      )}

      {tab === "models" && (
        <CatalogModels
          models={models.map((m) => ({
            id: m.id,
            name: m.name,
            houseType: m.houseType,
            buildMonths: m.buildMonths.toString(),
            sqft: m.sqft?.toString() ?? null,
            contractorFee: m.contractorFee?.toString() ?? null,
            notes: m.notes,
            // só o flag — o data URI da foto NÃO desce p/ a lista (peso da página)
            hasPhoto: !!m.photo,
            photoDims: m.photoWidth && m.photoHeight ? `${m.photoWidth}×${m.photoHeight}` : null,
            beds: m.beds?.toString() ?? null,
            baths: m.baths?.toString() ?? null,
            garageSpaces: m.garageSpaces?.toString() ?? null,
            builtSqft: m.builtSqft?.toString() ?? null,
            tagline: m.tagline,
            description: m.description,
            locations: m.locations.map((ml) => ({
              id: ml.id,
              locationId: ml.locationId,
              locationName: ml.location.name,
              salePrice: ml.salePrice.toString(),
              costPerformance: ml.costPerformance?.toString() ?? null,
              costContractor: ml.costContractor?.toString() ?? null,
              costOpenBook: ml.costOpenBook?.toString() ?? null,
              locationLotEstimate: ml.location.lotCostEstimate?.toString() ?? null,
            })),
          }))}
          allLocations={locations.map((l) => ({ id: l.id, name: l.name }))}
          typeFees={Object.fromEntries(feeByType)}
          history={history("MODEL")}
        />
      )}

      {tab === "fees" && (
        <Section
          title="Contractor fee by house type"
          hint="Fixed fee paid to 4U in contractor-fee mode (no profit participation). Fill in your real table."
        >
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {HOUSE_TYPES.map((t) => (
              <form key={t} action={saveHouseTypeFee} className="flex items-center gap-2">
                <input type="hidden" name="type" value={t} />
                <span className="w-28 text-sm text-slate-600">{HOUSE_TYPE_LABEL[t]}</span>
                <input name="fee" defaultValue={feeByType.get(t) ?? "0"} className={`${input} w-28`} />
                <button type="submit" className={saveBtn}>Save</button>
              </form>
            ))}
          </div>
        </Section>
      )}

      {tab === "banks" && (
        <CatalogBanks
          banks={banks.map((b) => ({
            id: b.id,
            name: b.name,
            ltcBuildPct: b.ltcBuildPct.toString(),
            ltcLandPct: b.ltcLandPct.toString(),
            financeLand: b.financeLand,
            ltvPct: b.ltvPct.toString(),
            haircutPct: b.haircutPct.toString(),
            perUnitCap: b.perUnitCap?.toString() ?? null,
            closingPermitPct: b.closingPermitPct.toString(),
            rateType: b.rateType,
            aprPct: b.aprPct.toString(),
            indexPct: b.indexPct.toString(),
            spreadPct: b.spreadPct.toString(),
            interestBasis: b.interestBasis,
            originationPct: b.originationPct.toString(),
            originationFlat: b.originationFlat.toString(),
            brokerPct: b.brokerPct.toString(),
            titleEscrowPct: b.titleEscrowPct.toString(),
            closingFeePct: b.closingFeePct.toString(),
            processingFee: b.processingFee.toString(),
            budgetReviewFee: b.budgetReviewFee.toString(),
            appraisalFee: b.appraisalFee.toString(),
            legalFee: b.legalFee.toString(),
            feesFinanced: b.feesFinanced,
            servicingMonthly: b.servicingMonthly.toString(),
            inspectionFeePerDraw: b.inspectionFeePerDraw.toString(),
            drawProcessingFee: b.drawProcessingFee.toString(),
            achFeePerBatch: b.achFeePerBatch.toString(),
            hasInterestReserve: b.hasInterestReserve,
            reserveInEnvelope: b.reserveInEnvelope,
            overfundingMode: b.overfundingMode,
            reserveMonths: b.reserveMonths.toString(),
            releaseMode: b.releaseMode,
            sweepPct: b.sweepPct.toString(),
            reconveyanceFee: b.reconveyanceFee.toString(),
            termMonths: b.termMonths.toString(),
            extensionMonths: b.extensionMonths.toString(),
            extensionFeePct: b.extensionFeePct.toString(),
            notes: b.notes,
            customFees: b.customFees.map((f) => ({
              id: f.id,
              name: f.name,
              timing: f.timing,
              kind: f.kind,
              amount: f.amount.toString(),
            })),
          }))}
          history={history("BANK")}
        />
      )}

      {tab === "banks" && (
        <Section
          title="Letters of intent (LOI)"
          hint="Suba o LOI em PDF — a AI extrai os termos e cria/atualiza o perfil do banco. O documento fica arquivado abaixo."
        >
          <BankLoiUpload banks={banks.map((b) => ({ id: b.id, name: b.name }))} />
          {lois.length > 0 && (
            <div className="mt-4 divide-y divide-slate-50 border-t border-slate-100">
              {lois.map((l) => (
                <div key={l.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="font-medium text-slate-700">
                    {l.bankProfile?.name ?? "(banco removido)"}
                    {l.loiNumber ? ` · LOI ${l.loiNumber}` : ""}
                  </span>
                  <span className="flex-1 px-4 text-slate-500">{l.propertyAddress ?? ""}</span>
                  <span className="text-xs text-slate-400">
                    {l.loiDate ? l.loiDate.toISOString().slice(0, 10) : ""}
                  </span>
                  <a
                    href={`/api/bank-lois/${l.id}/pdf`}
                    target="_blank"
                    className="ml-4 text-xs text-[#1f3a5f] hover:underline"
                  >
                    ver PDF
                  </a>
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {tab === "vehicle" && (
        <CatalogVehicle
          tiers={waterfallTiers.map((t) => ({
            hurdlePct: t.hurdlePct == null ? "" : t.hurdlePct.toString(),
            promotePct: t.promotePct.toString(),
          }))}
          costs={vehicleCosts.map((c) => ({
            name: c.name,
            amount: c.amount.toString(),
            timing: c.timing,
          }))}
        />
      )}

      {tab === "milestones" && (
        <Section
          title="Marcos de construção"
          hint="Fases da obra com peso (somam 100%). Marcar as fases concluídas de cada casa dá o % de obra e a base do draw. Vale para todas as casas."
        >
          <CatalogMilestones
            initial={buildMilestones.map((m) => ({
              key: m.key,
              name: m.name,
              detail: m.detail ?? "",
              weightPct: Number(m.weightPct),
            }))}
          />
        </Section>
      )}

      {tab === "scenarios" && (
        <CatalogScenarios
          scenarios={scenarios.map((s) => ({
            code: s.code,
            name: s.name,
            salePriceBufferPct: s.salePriceBufferPct.toString(),
            constructionCostBufferPct: s.constructionCostBufferPct.toString(),
            lotCostBufferPct: s.lotCostBufferPct.toString(),
            closingFeePct: s.closingFeePct.toString(),
            contingencyReservePct: s.contingencyReservePct.toString(),
            landAcquisitionDays: s.landAcquisitionDays.toString(),
            saleClosingDays: s.saleClosingDays.toString(),
            constructionDurationBufferM: s.constructionDurationBufferM.toString(),
            salesAbsorptionMonths: s.salesAbsorptionMonths?.toString() ?? null,
            emdPct: s.emdPct.toString(),
            stressSlippagePct: s.stressSlippagePct.toString(),
            unitGapDays: s.unitGapDays.toString(),
            sortOrder: s.sortOrder.toString(),
          }))}
          history={history("SCENARIO")}
        />
      )}
    </div>
  );
}
