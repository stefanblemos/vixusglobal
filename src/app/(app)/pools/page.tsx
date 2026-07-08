import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { capTable } from "@/lib/pools/math";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  FUNDING: "bg-amber-50 text-amber-700",
  ACTIVE: "bg-emerald-50 text-emerald-700",
  CLOSING: "bg-blue-50 text-blue-700",
  CLOSED: "bg-slate-100 text-slate-500",
};

const STATUS_LABEL: Record<string, string> = {
  FUNDING: "Funding",
  ACTIVE: "Active",
  CLOSING: "Closing",
  CLOSED: "Closed",
};

export default async function PoolsPage() {
  const pools = await prisma.investmentPool.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      houses: { select: { status: true } },
      members: { include: { entries: true, party: true, company: true } },
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Investment pools</h1>
          <p className="text-sm text-slate-500">
            One LLC per project pool — investors, houses, contributions and distributions.
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/pools/catalog"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Catalog
          </Link>
          <Link
            href="/pools/simulator"
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
          >
            Simulator
          </Link>
          <Link
            href="/pools/new"
            className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
          >
            + New pool
          </Link>
        </div>
      </div>

      {pools.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          No pools yet. Click <span className="font-medium">+ New pool</span> to create the first
          one (e.g. VHP-I for PH3).
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pools.map((p) => {
            const table = capTable(p.members);
            const sold = p.houses.filter((h) => h.status === "SOLD").length;
            return (
              <Link
                key={p.id}
                href={`/pools/${p.id}`}
                className="rounded-xl border border-slate-200 bg-white p-5 transition hover:border-[#1f3a5f]/40 hover:shadow-sm"
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium uppercase tracking-wide text-slate-400">
                    {p.code}
                    {p.alias ? ` · ${p.alias}` : ""}
                  </span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs ${STATUS_STYLE[p.status] ?? ""}`}
                  >
                    {STATUS_LABEL[p.status] ?? p.status}
                  </span>
                </div>
                <div className="mt-1 truncate text-lg font-semibold text-slate-800">{p.name}</div>
                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <div className="text-xs text-slate-400">Raised</div>
                    <div className="text-lg font-semibold tabular-nums text-slate-900">
                      {formatMoney(table.totalInvested, p.currency)}
                    </div>
                    {p.targetAmount && (
                      <div className="text-xs text-slate-400">
                        of {formatMoney(p.targetAmount, p.currency)}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs text-slate-400">Houses</div>
                    <div className="text-lg font-semibold tabular-nums text-slate-900">
                      {sold}/{p.houses.length}
                      <span className="ml-1 text-xs font-normal text-slate-400">sold</span>
                    </div>
                    <div className="text-xs text-slate-400">{p.members.length} member(s)</div>
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
