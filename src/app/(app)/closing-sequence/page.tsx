import Link from "next/link";
import { buildClosingSequence, type SeqNode } from "@/lib/closing/sequence";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  done: { label: "closed", cls: "bg-green-50 text-green-700" },
  ready: { label: "ready to close", cls: "bg-sky-50 text-sky-700" },
  blocked: { label: "waiting", cls: "bg-slate-100 text-slate-500" },
};

export default async function ClosingSequencePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const wanted = yParam && /^\d{4}$/.test(yParam) ? Number(yParam) : null;

  const probe = await buildClosingSequence(wanted ?? currentYear - 1);
  const years = probe.years.length ? probe.years : [currentYear - 1];
  const year = wanted ?? (years.includes(currentYear - 1) ? currentYear - 1 : years[0]);
  const seq = wanted === year ? probe : await buildClosingSequence(year);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Closing sequence</h1>
          <p className="text-sm text-slate-500">
            The order to close the tax return following the pass-through tree: each entity only closes
            after the investees that issue it a K-1. Close from top to bottom (step 1 → last). Final
            payer (final) = C-corp or individual.
          </p>
        </div>
        <a
          href={`/api/closing-sequence/pdf?year=${year}`}
          target="_blank"
          rel="noopener"
          className="shrink-0 rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
        >
          Open PDF
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Year:</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/closing-sequence?year=${y}`}
            className={`rounded-full px-3 py-1 ${y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {y}
          </Link>
        ))}
      </div>

      {seq.outOfOrder.length > 0 && (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50/60 p-4">
          <div className="text-sm font-medium text-red-800">
            ⚠ Closed out of order ({seq.outOfOrder.length}) — check whether the K-1 came in
          </div>
          {seq.outOfOrder.map((n) => (
            <div key={n.key} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm">
              <span className="font-medium text-slate-800">{n.name}</span>
              <span className="text-slate-500"> closed, but these investees are still open: </span>
              <span className="font-medium text-red-700">{n.outOfOrder.join(", ")}</span>
            </div>
          ))}
        </div>
      )}

      {seq.nextUp.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3 text-sm text-sky-800">
          <span className="font-medium">Next to close now:</span>{" "}
          {seq.nextUp.map((n) => n.name).join(", ")}
        </div>
      )}

      <div className="space-y-3">
        {seq.tiers.map((tier, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600">
              Step {i + 1}
            </div>
            <div className="divide-y divide-slate-100">
              {tier.map((n) => (
                <Row key={n.key} n={n} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400">
        Dependency comes from the K-1s declared on the tax return (authoritative) and, as a fallback,
        from pass-through ownership in the ownership records. ✓ = investee already closed. Lock the year
        on each company to mark it as closed.
      </p>
    </div>
  );
}

function Row({ n }: { n: SeqNode }) {
  const st = STATUS[n.status];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <div className="min-w-0">
        <span className="font-medium text-slate-800">
          {n.kind === "company" ? (
            <Link href={`/companies/${n.id}`} className="hover:underline">
              {n.name}
            </Link>
          ) : (
            n.name
          )}
        </span>
        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[11px] text-slate-600">
          {n.acronym}
        </span>
        {n.finalPayer && (
          <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
            {n.kind === "person" ? "1040" : "C-corp"} · final
          </span>
        )}
        {n.passesTo.length > 0 ? (
          <span className="block text-xs text-slate-500">
            ↑ passes to{" "}
            {n.passesTo.map((r, k) => (
              <span key={r.acronym + k} title={r.name}>
                {k > 0 && " · "}
                <span className="font-mono text-slate-600">{r.acronym}</span>{" "}
                {r.pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%
              </span>
            ))}
          </span>
        ) : (
          n.finalPayer && <span className="block text-xs text-slate-400">↑ final payer (doesn&apos;t pass through)</span>
        )}
        {n.deps.length > 0 && (
          <span className="block text-xs text-slate-400">
            ← depends on{" "}
            {n.deps.map((d, k) => (
              <span key={d.key} className={d.done ? "text-emerald-600" : "text-slate-400"}>
                {k > 0 && ", "}
                {d.name}
                {d.done ? " ✓" : ""}
              </span>
            ))}
          </span>
        )}
        {n.inCycle && (
          <span className="block text-xs text-amber-600">⚠ circular ownership — review the records</span>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
        <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${st.cls}`}>{st.label}</span>
        {n.outOfOrder.length > 0 && (
          <span
            title={`Closed before ${n.outOfOrder.join(", ")} — check whether the K-1 from that investee(s) came in.`}
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-amber-700"
          >
            ⚠ review
          </span>
        )}
      </div>
    </div>
  );
}
