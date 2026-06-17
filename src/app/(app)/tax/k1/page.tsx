import Link from "next/link";
import { prisma } from "@/lib/db";
import {
  reconcileK1s,
  K1_PROBLEM_STATUSES,
  type K1Edge,
  type K1Status,
  type K1Return,
} from "@/lib/ir/k1-reconcile";

export const dynamic = "force-dynamic";

const usd = (v: number | null) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(v);

const STATUS_META: Record<K1Status, { label: string; cls: string; help: string }> = {
  match: {
    label: "match",
    cls: "bg-green-50 text-green-700",
    help: "Both sides agree.",
  },
  amountDiff: {
    label: "amount differs",
    cls: "bg-red-50 text-red-700",
    help: "Both sides declared the K-1 but the amounts don't match.",
  },
  missingOnRecipient: {
    label: "not declared by recipient",
    cls: "bg-red-50 text-red-700",
    help: "The issuer's 1065 allocated income to this partner, but the recipient's return doesn't report receiving the K-1.",
  },
  reportedInTotal: {
    label: "on line 4 (not itemized)",
    cls: "bg-amber-50 text-amber-700",
    help: "The recipient reported its pass-through income as a lump on Form 1065 line 4 (from other partnerships) that covers this allocation — it's on the return, just not broken out per issuer.",
  },
  missingOnIssuer: {
    label: "not on issuer's 1065",
    cls: "bg-red-50 text-red-700",
    help: "The recipient declared receiving this K-1, but the issuer's return doesn't list them as a partner.",
  },
  noAlloc: {
    label: "no amount on issuer K-1",
    cls: "bg-amber-50 text-amber-700",
    help: "The recipient declared the K-1; the issuer lists them as a partner but with no allocated amount.",
  },
  issuerIrMissing: {
    label: "issuer IR not loaded",
    cls: "bg-slate-100 text-slate-500",
    help: "The recipient declared receiving this K-1, but the issuer's return for that year isn't in the system yet.",
  },
  recipientIrMissing: {
    label: "recipient IR not loaded",
    cls: "bg-slate-100 text-slate-500",
    help: "The issuer allocated income to this partner, but the recipient's return for that year isn't in the system yet.",
  },
};

function Badge({ status }: { status: K1Status }) {
  const m = STATUS_META[status];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${m.cls}`} title={m.help}>
      {m.label}
    </span>
  );
}

export default async function K1ReconcilePage() {
  const [returns, companies] = await Promise.all([
    prisma.taxReturn.findMany({
      where: { companyId: { not: null } },
      select: {
        companyId: true,
        year: true,
        taxForm: true,
        owners: true,
        k1sReceived: true,
        figures: true,
      },
    }),
    prisma.company.findMany({
      select: { id: true, legalName: true, tradeName: true, aliases: true, taxId: true },
    }),
  ]);

  const edges = reconcileK1s(returns as unknown as K1Return[], companies);

  const problems = edges.filter((e) => K1_PROBLEM_STATUSES.includes(e.status));
  const matched = edges.filter((e) => e.status === "match");
  const unverifiable = edges.filter(
    (e) => !K1_PROBLEM_STATUSES.includes(e.status) && e.status !== "match",
  );

  const years = [...new Set(edges.map((e) => e.year))].sort((a, b) => b - a);

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-sm text-slate-400">
          <Link href="/tax" className="hover:text-slate-600">
            Tax
          </Link>
          <span>/</span>
          <span>K-1 × 1065 reconciliation</span>
        </div>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">K-1 × 1065 reconciliation</h1>
        <p className="text-sm text-slate-500">
          Every intercompany pass-through across the group: each K-1 an entity issued on its 1065 is
          matched against the K-1 the receiving entity declared. Mismatches are where the accountant
          may have slipped.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Discrepancies" value={problems.length} tone={problems.length ? "bad" : "good"} />
        <Stat label="Matched" value={matched.length} tone="good" />
        <Stat label="On line 4 / IR pending" value={unverifiable.length} tone="muted" />
      </div>

      {edges.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No intercompany K-1 relationships found yet. Upload the partnership returns (1065) and their
          investees&rsquo; returns so the K-1s can be cross-checked.
        </div>
      ) : (
        <>
          {problems.length > 0 && (
            <Section
              title="Discrepancies — review these"
              subtitle="The two sides of the K-1 don't agree."
              edges={problems}
            />
          )}
          {years.map((y) => {
            const rows = edges.filter((e) => e.year === y);
            return (
              <Section
                key={y}
                title={`${y}`}
                subtitle={`${rows.length} relationship${rows.length > 1 ? "s" : ""}`}
                edges={rows}
              />
            );
          })}
        </>
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
  tone: "good" | "bad" | "muted";
}) {
  const cls =
    tone === "bad"
      ? "text-red-600"
      : tone === "good"
        ? "text-green-600"
        : "text-slate-500";
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className={`text-2xl font-semibold ${cls}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}

function CompanyCell({ id, name }: { id: string | null; name: string }) {
  if (!id) return <span className="text-slate-500">{name}</span>;
  return (
    <Link href={`/companies/${id}`} className="text-[#1f3a5f] hover:underline">
      {name}
    </Link>
  );
}

function Section({
  title,
  subtitle,
  edges,
}: {
  title: string;
  subtitle: string;
  edges: K1Edge[];
}) {
  return (
    <section className="space-y-2">
      <div className="flex items-baseline gap-3">
        <h2 className="text-lg font-medium text-slate-800">{title}</h2>
        <span className="text-sm text-slate-400">{subtitle}</span>
      </div>
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
              <th className="px-4 py-2 font-medium">Year</th>
              <th className="px-4 py-2 font-medium">Issuer (investee)</th>
              <th className="px-4 py-2 font-medium">Recipient (partner)</th>
              <th className="px-4 py-2 text-right font-medium">Allocated (1065)</th>
              <th className="px-4 py-2 text-right font-medium">Received (K-1)</th>
              <th className="px-4 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {edges.map((e, i) => (
              <tr key={i} className="border-b border-slate-50 last:border-0">
                <td className="px-4 py-2 tabular-nums text-slate-500">{e.year}</td>
                <td className="px-4 py-2">
                  <CompanyCell id={e.issuerId} name={e.issuerName} />
                </td>
                <td className="px-4 py-2">
                  <CompanyCell id={e.recipientId} name={e.recipientName} />
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {usd(e.issuerAmount)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-slate-700">
                  {usd(e.recipientAmount)}
                </td>
                <td className="px-4 py-2">
                  <Badge status={e.status} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
