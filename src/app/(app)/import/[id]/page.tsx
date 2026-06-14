import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { detectSuggestions } from "@/lib/qbo/detect";
import { matchCompany, matchParty } from "@/lib/qbo/match";
import { ImportSuggestions, type ResolvedSuggestion } from "@/components/import-suggestions";

const fmt = (v: { toString(): string } | null, currency: string) =>
  v == null
    ? ""
    : new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(v.toString()));

const REPORT_LABEL: Record<string, string> = {
  BALANCE_SHEET: "Balance Sheet",
  PROFIT_AND_LOSS: "Profit & Loss",
  UNKNOWN: "Unknown",
};

export default async function ImportDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const imp = await prisma.qboImport.findUnique({
    where: { id },
    include: { company: true, lines: { orderBy: { rowIndex: "asc" } } },
  });
  if (!imp) notFound();

  const [companies, parties] = await Promise.all([
    prisma.company.findMany({
      select: { id: true, legalName: true, tradeName: true, aliases: true },
    }),
    prisma.party.findMany({ select: { id: true, name: true } }),
  ]);

  const detected = detectSuggestions(
    imp.lines.map((l) => ({
      label: l.label,
      lineType: l.lineType,
      sectionPath: l.sectionPath,
      amount: l.value?.toString() ?? null,
    })),
  );

  const suggestions: ResolvedSuggestion[] = detected.map((s) => {
    const companyId = matchCompany(s.counterpartyName, companies);
    const partyId = companyId ? null : matchParty(s.counterpartyName, parties);
    const matchType = companyId ? "company" : partyId ? "party" : null;
    const matchId = companyId ?? partyId ?? null;
    const matchName = companyId
      ? (companies.find((c) => c.id === companyId)?.legalName ?? null)
      : partyId
        ? (parties.find((p) => p.id === partyId)?.name ?? null)
        : null;
    return {
      kind: s.kind,
      counterpartyName: s.counterpartyName,
      amount: s.amount,
      matchType,
      matchId,
      matchName,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <Link href="/import" className="text-sm text-slate-500 hover:text-slate-700">
          ← Imports
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">{imp.sourceCompanyName}</h1>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
            {REPORT_LABEL[imp.reportKind]}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">
            {imp.periodLabel}
          </span>
          {imp.company ? (
            <Link
              href={`/companies/${imp.company.id}`}
              className="rounded-full bg-[#1f3a5f]/[0.06] px-3 py-1 text-[#1f3a5f] hover:underline"
            >
              {imp.company.legalName}
            </Link>
          ) : (
            <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">Not linked</span>
          )}
        </div>
      </div>

      <ImportSuggestions
        importId={imp.id}
        importCompanyId={imp.companyId}
        suggestions={suggestions}
      />

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <h2 className="border-b border-slate-100 px-4 py-3 text-lg font-medium text-slate-800">
          Report lines
        </h2>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Account</th>
              <th className="px-4 py-2 font-medium">Code</th>
              <th className="px-4 py-2 text-right font-medium">{imp.columns[0] ?? "Total"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {imp.lines.map((l) => (
              <tr key={l.id} className={l.lineType === "TOTAL" ? "bg-slate-50/50" : ""}>
                <td
                  className={
                    l.lineType === "SECTION"
                      ? "px-4 py-1.5 font-medium text-slate-800"
                      : l.lineType === "TOTAL"
                        ? "px-4 py-1.5 font-medium text-slate-600"
                        : "px-4 py-1.5 text-slate-700"
                  }
                  style={{ paddingLeft: 16 + l.depth * 16 }}
                >
                  {l.label}
                </td>
                <td className="px-4 py-1.5 text-xs text-slate-400">{l.accountCode ?? ""}</td>
                <td className="px-4 py-1.5 text-right tabular-nums text-slate-700">
                  {fmt(l.value, l.currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
