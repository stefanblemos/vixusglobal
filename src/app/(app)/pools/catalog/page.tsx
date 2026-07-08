import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  deleteBankProfile,
  deleteModel,
  deleteModelLocation,
  saveBankProfile,
  saveHouseTypeFee,
  saveModel,
  saveModelLocation,
  saveScenario,
} from "@/lib/actions/catalog";
import { CatalogLocations, type HistoryEntry } from "@/components/catalog-locations";

export const dynamic = "force-dynamic";

const input =
  "w-full rounded border border-slate-300 px-2 py-1 text-sm outline-none focus:border-[#1f3a5f]";
const saveBtn =
  "rounded bg-[#1f3a5f] px-3 py-1 text-xs font-medium text-white hover:bg-[#16304f]";
const delBtn = "text-xs text-slate-300 hover:text-red-500";
const th = "px-2 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";

const HOUSE_TYPES = [
  "AFFORDABLE",
  "MID_RANGE",
  "UPPER_MIDDLE",
  "HIGH_END",
  "LUXURY",
  "DUPLEX",
  "TRIPLEX",
  "MULTIFAMILY",
] as const;

const TYPE_LABEL: Record<string, string> = {
  AFFORDABLE: "Affordable",
  MID_RANGE: "Mid-range",
  UPPER_MIDDLE: "Upper-middle",
  HIGH_END: "High-end",
  LUXURY: "Luxury",
  DUPLEX: "Duplex",
  TRIPLEX: "Triplex",
  MULTIFAMILY: "Multifamily",
};

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

export default async function PoolCatalogPage() {
  const [locations, models, fees, banks, scenarios, locationLog] = await Promise.all([
    prisma.catalogLocation.findMany({
      orderBy: { name: "asc" },
      include: { models: { include: { model: true }, orderBy: { model: { name: "asc" } } } },
    }),
    prisma.catalogModel.findMany({
      orderBy: { name: "asc" },
      include: { locations: { include: { location: true } } },
    }),
    prisma.houseTypeFee.findMany(),
    prisma.bankProfile.findMany({ orderBy: { name: "asc" } }),
    prisma.bufferScenario.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.catalogChangeLog.findMany({
      where: { entity: "LOCATION" },
      orderBy: { createdAt: "desc" },
      take: 200,
    }),
  ]);
  const feeByType = new Map(fees.map((f) => [f.type as string, f.fee.toString()]));
  const locationHistory: HistoryEntry[] = locationLog.map((h) => ({
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
            lotCost: ml.lotCost?.toString() ?? null,
          })),
        }))}
        history={locationHistory}
      />

      <Section
        title="House models"
        hint="Direct cost = builder cost without 4U margin. Contractor fee blank = uses the fee for the house type below. Sale price is set per location."
      >
        <div className="space-y-4">
          {[...models, null].map((m) => (
            <div key={m?.id ?? "new"} className="rounded-lg border border-slate-100 p-3">
              <form action={saveModel} className="flex flex-wrap items-center gap-2">
                {m && <input type="hidden" name="id" value={m.id} />}
                <input name="name" defaultValue={m?.name ?? ""} placeholder="New model…" className={`${input} w-40`} required />
                <select name="houseType" defaultValue={m?.houseType ?? "MID_RANGE"} className={`${input} w-36`}>
                  {HOUSE_TYPES.map((t) => (
                    <option key={t} value={t}>{TYPE_LABEL[t]}</option>
                  ))}
                </select>
                <label className="text-xs text-slate-400">months</label>
                <input name="buildMonths" defaultValue={m?.buildMonths?.toString() ?? "4"} className={`${input} w-16`} />
                <label className="text-xs text-slate-400">direct cost</label>
                <input name="directCost" defaultValue={m?.directCost?.toString() ?? ""} className={`${input} w-28`} />
                <label className="text-xs text-slate-400">fee override</label>
                <input name="contractorFee" defaultValue={m?.contractorFee?.toString() ?? ""} placeholder="type fee" className={`${input} w-24`} />
                <button type="submit" className={saveBtn}>{m ? "Save" : "Add model"}</button>
              </form>
              {m && (
                <form action={deleteModel} className="mt-1 text-right">
                  <input type="hidden" name="id" value={m.id} />
                  <button type="submit" className={delBtn}>✕ delete model</button>
                </form>
              )}
              {m && (
                <div className="mt-2 flex flex-wrap items-center gap-2 pl-2 text-sm">
                  <span className="text-xs uppercase tracking-wide text-slate-400">Available in:</span>
                  {m.locations.map((ml) => (
                    <span key={ml.id} className="flex items-center gap-1 rounded-full bg-slate-50 px-2 py-0.5 text-xs text-slate-600">
                      {ml.location.name} · ${Number(ml.salePrice).toLocaleString()}
                      <form action={deleteModelLocation} className="inline">
                        <input type="hidden" name="id" value={ml.id} />
                        <button type="submit" className={delBtn}>✕</button>
                      </form>
                    </span>
                  ))}
                  <form action={saveModelLocation} className="flex items-center gap-1">
                    <input type="hidden" name="modelId" value={m.id} />
                    <select name="locationId" defaultValue="" required className={`${input} w-36 py-0.5 text-xs`}>
                      <option value="" disabled>+ location…</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                    <input name="salePrice" placeholder="sale price" required className={`${input} w-24 py-0.5 text-xs`} />
                    <input name="lotCost" placeholder="lot (opt)" className={`${input} w-20 py-0.5 text-xs`} />
                    <button type="submit" className={saveBtn}>Set</button>
                  </form>
                </div>
              )}
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Contractor fee by house type"
        hint="Fixed fee paid to 4U in contractor-fee mode (no profit participation). Fill in your real table."
      >
        <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
          {HOUSE_TYPES.map((t) => (
            <form key={t} action={saveHouseTypeFee} className="flex items-center gap-2">
              <input type="hidden" name="type" value={t} />
              <span className="w-28 text-sm text-slate-600">{TYPE_LABEL[t]}</span>
              <input name="fee" defaultValue={feeByType.get(t) ?? "0"} className={`${input} w-28`} />
              <button type="submit" className={saveBtn}>Save</button>
            </form>
          ))}
        </div>
      </Section>

      <Section
        title="Bank profiles"
        hint="Construction loan assumptions per lender — LTC/LTV sizing, rates, fees, interest reserve. Percentages are annual/percent values."
      >
        <div className="space-y-3">
          {[...banks, null].map((b) => (
            <form key={b?.id ?? "new"} action={saveBankProfile} className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border border-slate-100 p-3">
              {b && <input type="hidden" name="id" value={b.id} />}
              {(
                [
                  ["name", "Bank", b?.name ?? "", "w-44"],
                  ["ltcBuildPct", "LTC build %", b?.ltcBuildPct?.toString() ?? "80", "w-20"],
                  ["ltcLandPct", "LTC land %", b?.ltcLandPct?.toString() ?? "50", "w-20"],
                  ["ltvPct", "LTV %", b?.ltvPct?.toString() ?? "70", "w-20"],
                  ["haircutPct", "Haircut %", b?.haircutPct?.toString() ?? "5", "w-20"],
                  ["aprPct", "APR %", b?.aprPct?.toString() ?? "12", "w-20"],
                  ["originationPct", "Orig. %", b?.originationPct?.toString() ?? "1", "w-20"],
                  ["originationFlat", "Orig. flat", b?.originationFlat?.toString() ?? "0", "w-24"],
                  ["closingFeePct", "Closing %", b?.closingFeePct?.toString() ?? "3", "w-20"],
                  ["appraisalFee", "Appraisal", b?.appraisalFee?.toString() ?? "1500", "w-24"],
                  ["legalFee", "Legal", b?.legalFee?.toString() ?? "1800", "w-24"],
                  ["inspectionFeePerDraw", "Inspection/draw", b?.inspectionFeePerDraw?.toString() ?? "205", "w-24"],
                  ["servicingMonthly", "Servicing/mo", b?.servicingMonthly?.toString() ?? "95", "w-24"],
                  ["perUnitCap", "Cap/unit", b?.perUnitCap?.toString() ?? "", "w-28"],
                ] as Array<[string, string, string, string]>
              ).map(([name, label, value, w]) => (
                <label key={name} className="block text-xs text-slate-400">
                  {label}
                  <input name={name} defaultValue={value} className={`${input} ${w} mt-0.5`} required={name === "name"} />
                </label>
              ))}
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <input type="checkbox" name="financeLand" defaultChecked={b?.financeLand ?? false} /> finance land
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <input type="checkbox" name="hasInterestReserve" defaultChecked={b?.hasInterestReserve ?? false} /> interest reserve
              </label>
              <label className="flex items-center gap-1 text-xs text-slate-500">
                <input type="checkbox" name="feesFinanced" defaultChecked={b?.feesFinanced ?? true} /> fees financed
              </label>
              <button type="submit" className={saveBtn}>{b ? "Save" : "Add bank"}</button>
              {b && (
                <button type="submit" formAction={deleteBankProfile} className={delBtn}>
                  ✕ delete
                </button>
              )}
            </form>
          ))}
        </div>
      </Section>

      <Section
        title="Buffer scenarios"
        hint="Ótimo / Real / Conservador (from the Buffers spec) plus customs. Buffers apply on top of catalog values: sale/cost/lot in %, land acquisition in days, duration in months."
      >
        <div className="space-y-3">
          {[...scenarios, null].map((s) => (
            <form key={s?.code ?? "new"} action={saveScenario} className="flex flex-wrap items-end gap-x-3 gap-y-2 rounded-lg border border-slate-100 p-3">
              {(
                [
                  ["code", "Code", s?.code ?? "", "w-24", Boolean(s)],
                  ["name", "Name", s?.name ?? "", "w-32", false],
                  ["salePriceBufferPct", "Sale %", s?.salePriceBufferPct?.toString() ?? "0", "w-16", false],
                  ["constructionCostBufferPct", "Cost %", s?.constructionCostBufferPct?.toString() ?? "0", "w-16", false],
                  ["lotCostBufferPct", "Lot %", s?.lotCostBufferPct?.toString() ?? "0", "w-16", false],
                  ["closingFeePct", "Closing fee %", s?.closingFeePct?.toString() ?? "8", "w-20", false],
                  ["contingencyReservePct", "Contingency %", s?.contingencyReservePct?.toString() ?? "5", "w-20", false],
                  ["landAcquisitionDays", "Land days", s?.landAcquisitionDays?.toString() ?? "20", "w-16", false],
                  ["constructionDurationBufferM", "Duration +m", s?.constructionDurationBufferM?.toString() ?? "0", "w-16", false],
                  ["salesAbsorptionMonths", "Absorption m", s?.salesAbsorptionMonths?.toString() ?? "", "w-16", false],
                  ["emdPct", "EMD %", s?.emdPct?.toString() ?? "10", "w-16", false],
                  ["sortOrder", "Order", s?.sortOrder?.toString() ?? "9", "w-14", false],
                ] as Array<[string, string, string, string, boolean]>
              ).map(([name, label, value, w, ro]) => (
                <label key={name} className="block text-xs text-slate-400">
                  {label}
                  <input name={name} defaultValue={value} readOnly={ro} className={`${input} ${w} mt-0.5 ${ro ? "bg-slate-50 text-slate-400" : ""}`} required={name === "code"} />
                </label>
              ))}
              <button type="submit" className={saveBtn}>{s ? "Save" : "Add scenario"}</button>
            </form>
          ))}
        </div>
      </Section>
    </div>
  );
}
