import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { PoolForm } from "@/components/pool-form";

export const dynamic = "force-dynamic";

const d = (v: Date | null) => (v ? v.toISOString().slice(0, 10) : "");
const fmtDate = (v: Date | null | undefined) => (v ? v.toISOString().slice(0, 10) : "—");

// Prazos derivados (vieram do Overview no layout novo 18/07): spans do projeto e por loan
const DAY_MS = 86400000;
const daysBetween = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / DAY_MS);
const addMonths = (dt: Date, m: number) => {
  const x = new Date(dt);
  x.setMonth(x.getMonth() + m);
  return x;
};
const spanLabel = (a: Date, b: Date) => {
  let months = (b.getFullYear() - a.getFullYear()) * 12 + (b.getMonth() - a.getMonth());
  if (addMonths(a, months) > b) months--;
  return `${months}m ${daysBetween(addMonths(a, months), b)}d (${daysBetween(a, b)} dias)`;
};
function RemainingDays({ to, done }: { to: Date | null; done?: boolean }) {
  if (done) return <span className="text-slate-400">encerrado</span>;
  if (!to) return null;
  const rem = daysBetween(new Date(), to);
  return rem >= 0 ? (
    <span className={rem <= 30 ? "font-semibold text-amber-700" : "font-semibold text-emerald-700"}>
      restam {rem} dias
    </span>
  ) : (
    <span className="font-semibold text-red-700">vencido há {-rem} dias</span>
  );
}

export default async function EditPoolPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await prisma.investmentPool.findUnique({
    where: { id },
    include: { loans: { orderBy: { createdAt: "asc" }, include: { bankProfile: true } } },
  });
  if (!pool) notFound();
  // entidade + nota participativa (17/07): os badges de pendência do Overview apontam p/ cá
  const [companies, noteLoans] = await Promise.all([
    prisma.company.findMany({ orderBy: { legalName: "asc" }, select: { id: true, legalName: true } }),
    prisma.intercompanyLoan.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, lender: { select: { legalName: true } }, borrower: { select: { legalName: true } } },
    }),
  ]);

  const loanTerms = pool.loans.map((l) => {
    const bank = l.bankProfile?.name ?? "banco a definir";
    const closing = l.closingDate ?? l.expectedClosingDate;
    const term = l.bankProfile?.termMonths ?? null;
    const maturity = closing && term ? addMonths(closing, term) : null;
    const ext = l.bankProfile?.extensionMonths ?? 0;
    return {
      id: l.id,
      bank,
      closing,
      closingReal: l.closingDate,
      closingPrev: l.expectedClosingDate,
      usesExpected: !l.closingDate && !!l.expectedClosingDate,
      term,
      maturity,
      ext,
    };
  });

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <Link href={`/pools/${pool.id}`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {pool.code}
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Edit pool</h1>
      </div>

      {/* Prazos derivados (layout novo 18/07): a leitura que morava nas Premissas do
          Overview — os campos editáveis correspondentes estão no form abaixo */}
      {(pool.startDate || pool.loans.length > 0) && (
        <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
            Prazos derivados
          </h2>
          <div className="mt-3 grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {pool.startDate && (pool.plannedEndDate || pool.effectiveEndDate) && (
              <div>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">Prazo do projeto</div>
                <div className="text-sm font-semibold text-slate-800">
                  {spanLabel(pool.startDate, pool.effectiveEndDate ?? pool.plannedEndDate!)} ·{" "}
                  <RemainingDays to={pool.plannedEndDate} done={!!pool.effectiveEndDate} />
                </div>
              </div>
            )}
            {loanTerms.map((lt) => (
              <div key={lt.id}>
                <div className="text-[10px] uppercase tracking-wider text-slate-400">
                  Loan — {lt.bank}
                </div>
                <div className="text-sm font-semibold text-slate-800">
                  {lt.closing && lt.term && lt.maturity ? (
                    <>
                      {spanLabel(lt.closing, lt.maturity)}
                      {lt.usesExpected && <span className="font-normal text-slate-400"> (closing prev.)</span>} ·{" "}
                      <RemainingDays to={lt.maturity} />
                      {lt.ext > 0 && (
                        <span className="font-normal text-slate-400"> · +{lt.ext}m ext. possível</span>
                      )}
                    </>
                  ) : (
                    <span className="text-amber-700">— registrar closing do loan</span>
                  )}
                  <div className="text-xs font-normal text-slate-500">
                    closing prev. {fmtDate(lt.closingPrev)} · real{" "}
                    {lt.closingReal ? fmtDate(lt.closingReal) : <span className="text-amber-700">—</span>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <PoolForm
        values={{
          id: pool.id,
          code: pool.code,
          name: pool.name,
          alias: pool.alias ?? "",
          status: pool.status,
          unitPrice: pool.unitPrice.toString(),
          targetAmount: pool.targetAmount?.toString() ?? "",
          profitSharePct:
            pool.profitSharePct == null ? "" : ((1 - Number(pool.profitSharePct)) * 100).toString(),
          profitShareTiming: pool.profitShareTiming ?? "",
          fundingDeadline: d(pool.fundingDeadline),
          startDate: d(pool.startDate),
          plannedEndDate: d(pool.plannedEndDate),
          effectiveEndDate: d(pool.effectiveEndDate),
          companyId: pool.companyId ?? "",
          noteLoanId: pool.noteLoanId ?? "",
          notes: pool.notes ?? "",
        }}
        companies={companies.map((c) => ({ id: c.id, name: c.legalName }))}
        noteLoans={noteLoans.map((n) => ({
          id: n.id,
          label: `${n.lender.legalName} → ${n.borrower.legalName}`,
        }))}
      />
    </div>
  );
}
