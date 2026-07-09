import Link from "next/link";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { toggleLoanEntryReconciled } from "@/lib/actions/pool-loan";
import { AddDrawForm, type DrawPool } from "@/components/pool-draw-form";

export const dynamic = "force-dynamic";

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-1.5 text-sm text-slate-600";
const tdRight = "px-3 py-1.5 text-right text-sm tabular-nums text-slate-700";

const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

// Tela GLOBAL de draws: lançar solicitações/liberações por casa em qualquer pool. O draw e
// os fees previstos do contrato do banco entram no loan statement do pool para conciliação.
export default async function DrawsPage() {
  const pools = await prisma.investmentPool.findMany({
    where: { loan: { isNot: null } },
    orderBy: { code: "asc" },
    include: {
      houses: { orderBy: { createdAt: "asc" }, select: { id: true, address: true } },
      loan: { include: { bankProfile: true } },
    },
  });

  const draws = await prisma.poolLoanEntry.findMany({
    where: { type: "DRAW" },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
    take: 100,
    include: { house: true, loan: { include: { pool: true } } },
  });

  const drawPools: DrawPool[] = pools.map((p) => {
    const b = p.loan!.bankProfile;
    const feeBits: string[] = [];
    if (b) {
      if (Number(b.drawProcessingFee) > 0) feeBits.push(`$${Number(b.drawProcessingFee)} processing`);
      if (Number(b.inspectionFeePerDraw) > 0) feeBits.push(`$${Number(b.inspectionFeePerDraw)} inspection`);
      if (Number(b.achFeePerBatch) > 0) feeBits.push(`$${Number(b.achFeePerBatch)} ACH por lote (1x por data)`);
    }
    return {
      id: p.id,
      label: `${p.code}${p.alias ? ` · ${p.alias}` : ""} — ${b?.name ?? "banco a definir"}${p.loan!.loanNumber ? ` (${p.loan!.loanNumber})` : ""}`,
      feesHint:
        feeBits.length > 0
          ? `Fees previstos lançados junto (contrato ${b?.name}): ${feeBits.join(" + ")} — validar depois na conciliação.`
          : "Sem fees de draw no perfil do banco.",
      houses: p.houses,
    };
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Draws</h1>
        <p className="text-sm text-slate-500">
          Solicitações e liberações do banco, por casa, em todos os pools. Cada lançamento entra
          no loan statement do pool com os fees previstos do contrato, para conciliação com o
          extrato.
        </p>
      </div>

      {drawPools.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-sm text-slate-500">
          Nenhum pool com construction loan ainda — configure os termos na aba Loan statement do
          pool.
        </div>
      ) : (
        <AddDrawForm pools={drawPools} />
      )}

      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-medium text-slate-800">Draws lançados</h2>
          <p className="text-xs text-slate-400">Últimos 100, todos os pools. ✓ = conciliado com o extrato.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className={th}>Pool</th>
                <th className={th}>Casa</th>
                <th className={th}>Solicitado em</th>
                <th className={thRight}>Solicitado</th>
                <th className={th}>Creditado em</th>
                <th className={thRight}>Liberado</th>
                <th className={thRight}>Δ</th>
                <th className={thRight}>✓</th>
              </tr>
            </thead>
            <tbody>
              {draws.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-6 text-center text-sm text-slate-400">
                    Nenhum draw lançado ainda.
                  </td>
                </tr>
              )}
              {draws.map((d) => {
                const delta =
                  d.requestedAmount != null ? Number(d.amount) - Number(d.requestedAmount) : null;
                return (
                  <tr key={d.id} className={`border-b border-slate-50 ${d.reconciled ? "" : "bg-amber-50/30"}`}>
                    <td className={td}>
                      <Link
                        href={`/pools/${d.loan.poolId}/loan`}
                        className="font-medium text-[#1f3a5f] hover:underline"
                      >
                        {d.loan.pool.code}
                      </Link>
                    </td>
                    <td className={`${td} text-slate-500`}>{d.house?.address ?? "—"}</td>
                    <td className={td}>{fmtDate(d.requestDate)}</td>
                    <td className={tdRight}>
                      {d.requestedAmount != null ? formatMoney(d.requestedAmount, "USD") : "—"}
                    </td>
                    <td className={td}>{fmtDate(d.date)}</td>
                    <td className={`${tdRight} font-medium`}>{formatMoney(d.amount, "USD")}</td>
                    <td className={`${tdRight} ${delta != null && delta !== 0 ? "text-amber-600" : "text-slate-400"}`}>
                      {delta != null ? formatMoney(delta, "USD") : "—"}
                    </td>
                    <td className={tdRight}>
                      <form action={toggleLoanEntryReconciled} className="inline">
                        <input type="hidden" name="entryId" value={d.id} />
                        <input type="hidden" name="poolId" value={d.loan.poolId} />
                        <button
                          type="submit"
                          className={d.reconciled ? "text-emerald-600" : "text-slate-300 hover:text-emerald-600"}
                          title={d.reconciled ? "Conciliado" : "Marcar conciliado"}
                        >
                          ✓
                        </button>
                      </form>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
