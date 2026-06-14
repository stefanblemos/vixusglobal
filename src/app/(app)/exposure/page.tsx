import { prisma } from "@/lib/db";
import { matchCompany, matchParty, stripLoanPrefix } from "@/lib/qbo/match";
import { extractExposure } from "@/lib/qbo/exposure";
import { loadRatesAsOf, toUsd } from "@/lib/fx/rates";

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
const local = (n: number, cur: string) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: cur }).format(n);

interface Item {
  name: string;
  matched: boolean;
  localAmount: number;
  usdAmount: number;
}
interface CompanyExposure {
  companyId: string;
  companyName: string;
  currency: string;
  receivables: Item[];
  payables: Item[];
  recvUsd: number;
  payUsd: number;
}

export default async function ExposurePage() {
  const [companies, parties, imports] = await Promise.all([
    prisma.company.findMany({
      select: { id: true, legalName: true, tradeName: true, aliases: true },
    }),
    prisma.party.findMany({ select: { id: true, name: true } }),
    prisma.qboImport.findMany({
      where: { reportKind: "BALANCE_SHEET", companyId: { not: null } },
      orderBy: { createdAt: "desc" },
      include: { lines: true, company: true },
    }),
  ]);

  const companyById = new Map(companies.map((c) => [c.id, c]));
  const partyById = new Map(parties.map((p) => [p.id, p]));
  const resolve = (name: string) => matchCompany(name, companies);
  const rates = await loadRatesAsOf(new Date());

  const seen = new Set<string>();
  const latest = imports.filter((imp) => {
    if (!imp.companyId || seen.has(imp.companyId)) return false;
    seen.add(imp.companyId);
    return true;
  });

  const displayName = (rawLabel: string, id: string | null): { name: string; matched: boolean } => {
    if (id) return { name: companyById.get(id)?.legalName ?? rawLabel, matched: true };
    const pid = matchParty(rawLabel, parties);
    if (pid) return { name: partyById.get(pid)?.name ?? rawLabel, matched: true };
    return { name: stripLoanPrefix(rawLabel), matched: false };
  };

  const exposures: CompanyExposure[] = latest
    .map((imp) => {
      const currency = imp.lines[0]?.currency ?? "USD";
      const items = extractExposure(
        imp.lines.map((l) => ({
          label: l.label,
          lineType: l.lineType,
          sectionPath: l.sectionPath,
          amount: l.value?.toString() ?? null,
        })),
        resolve,
      );
      const toItem = (it: (typeof items)[number]): Item => {
        const dn = displayName(it.counterpartyName, it.counterpartyId);
        return {
          name: dn.name,
          matched: dn.matched,
          localAmount: it.amount,
          usdAmount: toUsd(it.amount, currency, rates),
        };
      };
      const receivables = items.filter((i) => i.kind === "RECEIVABLE").map(toItem);
      const payables = items.filter((i) => i.kind === "PAYABLE").map(toItem);
      return {
        companyId: imp.companyId!,
        companyName: imp.company?.legalName ?? imp.sourceCompanyName,
        currency,
        receivables,
        payables,
        recvUsd: receivables.reduce((s, i) => s + i.usdAmount, 0),
        payUsd: payables.reduce((s, i) => s + i.usdAmount, 0),
      };
    })
    .filter((e) => e.receivables.length || e.payables.length)
    .sort((a, b) => b.recvUsd + b.payUsd - (a.recvUsd + a.payUsd));

  const totalRecv = exposures.reduce((s, e) => s + e.recvUsd, 0);
  const totalPay = exposures.reduce((s, e) => s + e.payUsd, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Loan exposure</h1>
        <p className="text-sm text-slate-500">
          All loan assets (receivable) and liabilities (payable) per company, including external
          lenders. Amounts in USD — the debt currency; foreign balances converted at the locked
          rate.
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total receivable" value={usd(totalRecv)} cls="text-green-700" />
        <Stat label="Total payable" value={usd(totalPay)} cls="text-red-700" />
        <Stat label="Net" value={usd(totalRecv - totalPay)} cls="text-slate-800" />
      </div>

      <div className="space-y-4">
        {exposures.map((e) => (
          <div key={e.companyId} className="rounded-xl border border-slate-200 bg-white p-5">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="font-medium text-slate-800">
                {e.companyName}
                {e.currency !== "USD" && (
                  <span className="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">
                    {e.currency}
                  </span>
                )}
              </h2>
              <div className="text-sm">
                <span className="text-green-700">{usd(e.recvUsd)}</span>
                <span className="mx-2 text-slate-300">·</span>
                <span className="text-red-700">{usd(e.payUsd)}</span>
                <span className="mx-2 text-slate-300">·</span>
                <span className="font-medium text-slate-700">net {usd(e.recvUsd - e.payUsd)}</span>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <ExposureList
                title="Receivable (loans to others)"
                items={e.receivables}
                currency={e.currency}
              />
              <ExposureList
                title="Payable (loans / debt)"
                items={e.payables}
                currency={e.currency}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExposureList({
  title,
  items,
  currency,
}: {
  title: string;
  items: Item[];
  currency: string;
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400">{title}</div>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">—</p>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-100">
            {items.map((i, idx) => (
              <tr key={idx}>
                <td className="py-1.5 pr-2">
                  <span className={i.matched ? "text-slate-800" : "text-slate-500"}>{i.name}</span>
                  {!i.matched && <span className="ml-1 text-xs text-amber-600">ext</span>}
                </td>
                <td className="py-1.5 text-right tabular-nums text-slate-700">
                  {usd(i.usdAmount)}
                  {currency !== "USD" && (
                    <span className="ml-1 text-xs text-slate-400">
                      ({local(i.localAmount, currency)})
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${cls}`}>{value}</div>
    </div>
  );
}
