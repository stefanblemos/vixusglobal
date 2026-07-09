import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { AddDrawForm, type DrawPool } from "@/components/pool-draw-form";
import { DrawList, type DrawRow } from "@/components/pool-draw-list";

export const dynamic = "force-dynamic";

const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-1.5 text-sm text-slate-600";
const tdRight = "px-3 py-1.5 text-right text-sm tabular-nums text-slate-700";

const fmtDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

// Tela GLOBAL de draws. Fluxo real: a solicitação é salva primeiro (aguardando o banco);
// a liberação é registrada quando a resposta chega — só então entra no saldo com os fees
// previstos. O painel por casa mostra aprovado (d=0), creditado, pendente e o DISPONÍVEL.
export default async function DrawsPage() {
  const pools = await prisma.investmentPool.findMany({
    where: { loan: { isNot: null } },
    orderBy: { code: "asc" },
    include: {
      houses: {
        orderBy: { createdAt: "asc" },
        select: { id: true, address: true, bankLoanAmount: true },
      },
      loan: {
        include: {
          bankProfile: true,
          entries: { where: { type: "DRAW" }, select: { houseId: true, amount: true, requestedAmount: true, pending: true } },
        },
      },
    },
  });

  const draws = await prisma.poolLoanEntry.findMany({
    where: { type: "DRAW" },
    orderBy: [{ pending: "desc" }, { date: "desc" }, { createdAt: "desc" }],
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
          ? `Fees previstos na liberação (contrato ${b?.name}): ${feeBits.join(" + ")}.`
          : "Sem fees de draw no perfil do banco.",
      houses: p.houses.map((h) => ({ id: h.id, address: h.address })),
    };
  });

  const drawRows: DrawRow[] = draws.map((d) => ({
    id: d.id,
    poolId: d.loan.poolId,
    poolCode: d.loan.pool.code,
    houseId: d.houseId,
    houseAddress: d.house?.address ?? null,
    pending: d.pending,
    requestedAmount: d.requestedAmount?.toString() ?? null,
    requestDate: fmtDate(d.requestDate),
    amount: d.amount.toString(),
    date: fmtDate(d.date)!,
    reconciled: d.reconciled,
    memo: d.memo,
  }));

  const housesByPool = Object.fromEntries(
    pools.map((p) => [p.id, p.houses.map((h) => ({ id: h.id, address: h.address }))]),
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Draws</h1>
        <p className="text-sm text-slate-500">
          Solicitações e liberações do banco, por casa. Peça olhando o painel de disponibilidade;
          a liberação entra no loan statement com os fees do contrato, para conciliação.
        </p>
      </div>

      {/* Painel por casa: aprovado (d=0) · creditado · pendente · disponível */}
      {pools.map((p) => {
        const byHouse = new Map<string, { credited: number; pending: number }>();
        for (const e of p.loan!.entries) {
          const k = e.houseId ?? "__none__";
          const cur = byHouse.get(k) ?? { credited: 0, pending: 0 };
          if (e.pending) cur.pending += Number(e.requestedAmount ?? 0);
          else cur.credited += Number(e.amount);
          byHouse.set(k, cur);
        }
        const totals = { budget: 0, credited: 0, pending: 0 };
        return (
          <section key={p.id} className="rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 px-5 py-4">
              <h2 className="text-base font-medium text-slate-800">
                {p.code}
                {p.alias ? ` · ${p.alias}` : ""} — disponibilidade por casa
              </h2>
              <p className="text-xs text-slate-400">
                Disponível = aprovado pelo banco (d=0) − creditado − solicitado aguardando.
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className={th}>Casa</th>
                    <th className={thRight}>Aprovado (d=0)</th>
                    <th className={thRight}>Creditado</th>
                    <th className={thRight}>Aguardando</th>
                    <th className={thRight}>Disponível</th>
                  </tr>
                </thead>
                <tbody>
                  {p.houses.map((h) => {
                    const agg = byHouse.get(h.id) ?? { credited: 0, pending: 0 };
                    const budget = Number(h.bankLoanAmount ?? 0);
                    const available = budget - agg.credited - agg.pending;
                    totals.budget += budget;
                    totals.credited += agg.credited;
                    totals.pending += agg.pending;
                    return (
                      <tr key={h.id} className="border-b border-slate-50">
                        <td className={`${td} font-medium text-slate-800`}>{h.address}</td>
                        <td className={tdRight}>
                          {h.bankLoanAmount != null ? formatMoney(h.bankLoanAmount, "USD") : "—"}
                        </td>
                        <td className={tdRight}>{formatMoney(agg.credited, "USD")}</td>
                        <td className={`${tdRight} ${agg.pending > 0 ? "text-blue-700" : ""}`}>
                          {agg.pending > 0 ? formatMoney(agg.pending, "USD") : "—"}
                        </td>
                        <td
                          className={`${tdRight} font-semibold ${available < 0 ? "text-red-600" : available === 0 ? "text-slate-400" : "text-emerald-700"}`}
                        >
                          {h.bankLoanAmount != null ? formatMoney(available, "USD") : "—"}
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-slate-50/60">
                    <td className={`${td} font-semibold text-slate-800`}>Total</td>
                    <td className={`${tdRight} font-semibold`}>{formatMoney(totals.budget, "USD")}</td>
                    <td className={`${tdRight} font-semibold`}>{formatMoney(totals.credited, "USD")}</td>
                    <td className={`${tdRight} font-semibold`}>{formatMoney(totals.pending, "USD")}</td>
                    <td className={`${tdRight} font-semibold`}>
                      {formatMoney(totals.budget - totals.credited - totals.pending, "USD")}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        );
      })}

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
          <p className="text-xs text-slate-400">
            Pendentes primeiro. Clique na linha para editar / registrar a liberação. ✓ =
            conciliado com o extrato.
          </p>
        </div>
        <DrawList draws={drawRows} housesByPool={housesByPool} />
      </section>
    </div>
  );
}
