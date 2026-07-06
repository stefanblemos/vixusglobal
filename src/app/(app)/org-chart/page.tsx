import Link from "next/link";
import { buildOrgChart } from "@/lib/org/chart";
import { OrgChartSvg } from "./org-chart-svg";

export const dynamic = "force-dynamic";

export default async function OrgChartPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const wanted = yParam && /^\d{4}$/.test(yParam) ? Number(yParam) : null;

  const probe = await buildOrgChart(wanted ?? currentYear - 1);
  const years = probe.years.length ? probe.years : [currentYear - 1];
  const year = wanted ?? (years.includes(currentYear - 1) ? currentYear - 1 : years[0]);
  const chart = wanted === year ? probe : await buildOrgChart(year);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Org chart</h1>
        <p className="text-sm text-slate-500">
          Structure of owners × holdings (pass-through) with the percentages, effective for the
          selected year. Ultimate owners (individuals/top holdings) sit at the top; income flows from
          the bottom up (via K-1). Changing an owner in the records for a year is reflected here.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Year:</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/org-chart?year=${y}`}
            className={`rounded-full px-3 py-1 ${y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {y}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-[#1f3a5f]" /> Person (individual · 1040)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border border-slate-300 bg-white" /> Pass-through company
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border-2 border-amber-500 bg-white" /> C-corp (pays at the entity level)
        </span>
        <span className="text-slate-400">% on the line = the owner&apos;s stake in the holding.</span>
        <span className="text-slate-400">Hover over a box to highlight the lineage.</span>
      </div>

      {chart.nodes.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No ownership registered effective in {year}. Register it in{" "}
          <Link href="/parties" className="text-[#1f3a5f] hover:underline">
            Owners / Ownership
          </Link>
          .
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white p-2">
          <OrgChartSvg
            nodes={chart.nodes}
            edges={chart.edges}
            width={chart.width}
            height={chart.height}
          />
        </div>
      )}

      <p className="text-xs text-slate-400">
        Data from the Ownership records (effective by date). If the owners of an entity add up to less
        than 100%, some ownership is not yet registered — it shows in gray in the &ldquo;owners:
        x%&rdquo; label.
      </p>
    </div>
  );
}
