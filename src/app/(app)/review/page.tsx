import Link from "next/link";
import { buildReviewFindings, type ReviewFinding } from "@/lib/review/findings";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<ReviewFinding["kind"], string> = {
  k1: "K-1 × 1065",
  income: "Income omission",
  "missing-year": "Missing return",
  unregistered: "New entity",
  treatment: "Tax treatment",
};

const SEV_DOT: Record<ReviewFinding["severity"], string> = {
  high: "bg-red-500",
  medium: "bg-amber-500",
  info: "bg-slate-400",
};

export default async function ReviewPage() {
  const findings = await buildReviewFindings();
  const high = findings.filter((f) => f.severity === "high").length;
  const medium = findings.filter((f) => f.severity === "medium").length;
  const byKind = (k: ReviewFinding["kind"]) => findings.filter((f) => f.kind === k).length;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Review</h1>
        <p className="text-sm text-slate-500">
          Everything across the group that needs your eye — K-1 mismatches, income invoiced but not
          on a return, missing past returns, and entities not yet registered. The accountant
          conference, in one queue.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Discrepancies (high)" value={high} tone={high ? "bad" : "good"} />
        <Stat label="To complete (medium)" value={medium} tone={medium ? "warn" : "good"} />
        <Stat label="K-1 × 1065" value={byKind("k1")} tone="muted" />
        <Stat label="Income omissions" value={byKind("income")} tone="muted" />
      </div>

      {findings.length === 0 ? (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-6 text-sm text-emerald-800">
          Nothing to review — every return reconciles, no missing years, no unregistered entities. ✓
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Year</th>
                <th className="px-4 py-2 font-medium">Type</th>
                <th className="px-4 py-2 font-medium">Finding</th>
                <th className="px-4 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {findings.map((f, i) => (
                <tr key={i} className="align-top hover:bg-slate-50/60">
                  <td className="px-4 py-3">
                    <span className="flex items-center gap-2 font-medium text-slate-800">
                      <span className={`h-2 w-2 rounded-full ${SEV_DOT[f.severity]}`} />
                      {f.companyName}
                    </span>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-slate-500">{f.year ?? "—"}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                      {KIND_LABEL[f.kind]}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{f.title}</div>
                    <div className="text-xs text-slate-500">{f.detail}</div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={f.href} className="text-sm text-[#1f3a5f] hover:underline">
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "bad" | "warn" | "muted";
}) {
  const cls =
    tone === "bad"
      ? "text-red-600"
      : tone === "warn"
        ? "text-amber-600"
        : tone === "good"
          ? "text-emerald-600"
          : "text-slate-700";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className={`text-2xl font-semibold ${cls}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
