import { prisma } from "@/lib/db";
import { matchCompany } from "@/lib/qbo/match";
import { extractPositions, reconcile, type ReconStatus } from "@/lib/qbo/reconcile";

const fmtUSD = (v: number | null) =>
  v == null
    ? "—"
    : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);

const STATUS: Record<ReconStatus, { label: string; cls: string }> = {
  RECONCILED: { label: "Reconciled", cls: "bg-green-50 text-green-700" },
  MISMATCH: { label: "Mismatch", cls: "bg-red-50 text-red-700" },
  ONE_SIDED: { label: "One-sided", cls: "bg-amber-50 text-amber-700" },
};

export default async function ReportsPage() {
  const companies = await prisma.company.findMany({
    select: { id: true, legalName: true, tradeName: true, aliases: true },
  });
  const nameOf = (id: string) => companies.find((c) => c.id === id)?.legalName ?? "—";
  const resolve = (name: string) => matchCompany(name, companies);

  // Último Balance Sheet importado por empresa.
  const imports = await prisma.qboImport.findMany({
    where: { reportKind: "BALANCE_SHEET", companyId: { not: null } },
    orderBy: { createdAt: "desc" },
    include: { lines: true },
  });
  const seen = new Set<string>();
  const latest = imports.filter((imp) => {
    if (!imp.companyId || seen.has(imp.companyId)) return false;
    seen.add(imp.companyId);
    return true;
  });

  const positions = latest.flatMap((imp) =>
    extractPositions(
      imp.companyId!,
      imp.lines.map((l) => ({
        label: l.label,
        lineType: l.lineType,
        sectionPath: l.sectionPath,
        amount: l.value?.toString() ?? null,
      })),
      resolve,
    ),
  );
  const rows = reconcile(positions);

  const counts = {
    reconciled: rows.filter((r) => r.status === "RECONCILED").length,
    mismatch: rows.filter((r) => r.status === "MISMATCH").length,
    oneSided: rows.filter((r) => r.status === "ONE_SIDED").length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Intercompany reconciliation</h1>
        <p className="text-sm text-slate-500">
          Cross-checks each loan position against the counterparty&apos;s books, using the latest
          imported Balance Sheet per company. {latest.length} balance sheet(s) covered.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Reconciled" value={counts.reconciled} cls="text-green-700" />
        <Stat label="Mismatch" value={counts.mismatch} cls="text-red-700" />
        <Stat label="One-sided" value={counts.oneSided} cls="text-amber-700" />
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        {rows.length === 0 ? (
          <p className="p-6 text-sm text-slate-500">
            No intercompany positions found yet. Import Balance Sheets for at least two related
            companies.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Creditor</th>
                <th className="px-4 py-3 font-medium">Debtor</th>
                <th className="px-4 py-3 text-right font-medium">Creditor reports</th>
                <th className="px-4 py-3 text-right font-medium">Debtor reports</th>
                <th className="px-4 py-3 text-right font-medium">Diff</th>
                <th className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="px-4 py-3 font-medium text-slate-800">{nameOf(r.creditorId)}</td>
                  <td className="px-4 py-3 text-slate-700">{nameOf(r.debtorId)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {fmtUSD(r.creditorAmount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {fmtUSD(r.debtorAmount)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700">
                    {r.status === "MISMATCH" ? fmtUSD(r.diff) : ""}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-3 py-1 text-xs ${STATUS[r.status].cls}`}>
                      {STATUS[r.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`text-2xl font-semibold ${cls}`}>{value}</div>
    </div>
  );
}
