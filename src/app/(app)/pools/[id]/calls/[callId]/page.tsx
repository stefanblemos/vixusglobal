import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { memberName } from "@/lib/pools/math";
import { deleteCapitalCall, registerCallPayment } from "@/lib/actions/pools";
import { PrintButton } from "@/components/pool-capital-forms";

export const dynamic = "force-dynamic";

const fmtDate = (d: Date) => d.toISOString().slice(0, 10);

// Relatório da chamada de capital — layout limpo para imprimir/PDF e enviar aos sócios.
// Mostra pro rata × recebido × status (05/10): quem pagou integral, parcial, não participou
// ou cobriu a diferença (e por isso ganhou units a mais).
export default async function CapitalCallReportPage({
  params,
}: {
  params: Promise<{ id: string; callId: string }>;
}) {
  const { id, callId } = await params;
  const call = await prisma.poolCapitalCall.findUnique({
    where: { id: callId },
    include: {
      pool: { include: { members: { include: { entries: true, party: true, company: true } } } },
      lines: { include: { member: { include: { party: true, company: true } } } },
    },
  });
  if (!call || call.poolId !== id) notFound();
  const pool = call.pool;
  const cur = pool.currency;
  // % CONGELADO no rateio da chamada (linha/total) — não recalcula com pagamentos parciais
  const pctOf = (amount: unknown) => ((Number(amount) / Number(call.totalAmount)) * 100).toFixed(2);
  const paid = call.lines.filter((l) => l.paid).length;
  const receivedTotal = call.lines.reduce((s, l) => s + Number(l.receivedAmount ?? 0), 0);
  const unitsIssued = receivedTotal / Number(pool.unitPrice);
  const gap = Number(call.totalAmount) - receivedTotal;

  const statusOf = (l: (typeof call.lines)[number]) => {
    if (!l.paid) return ["Pendente", "bg-amber-50 text-amber-700"];
    const r = Number(l.receivedAmount ?? 0), p = Number(l.amount);
    if (r === 0) return ["Não participou", "bg-red-50 text-red-700"];
    if (Math.abs(r - p) < 0.005) return ["Recebido", "bg-emerald-50 text-emerald-700"];
    if (r < p) return ["Parcial", "bg-amber-50 text-amber-700"];
    return ["Cobriu diferença", "bg-blue-50 text-[#1f3a5f]"];
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-end justify-between print:hidden">
        <div>
          <Link href={`/pools/${pool.id}?tab=investors`} className="text-sm text-slate-500 hover:text-slate-700">
            ← {pool.code}
            {pool.alias ? ` · ${pool.alias}` : ""}
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-800">Capital call</h1>
        </div>
        <div className="flex gap-2">
          <PrintButton />
          {paid === 0 && (
            <form action={deleteCapitalCall}>
              <input type="hidden" name="callId" value={call.id} />
              <button
                type="submit"
                className="rounded-lg border border-red-200 px-4 py-2 text-sm text-red-500 hover:bg-red-50"
              >
                Delete
              </button>
            </form>
          )}
        </div>
      </div>

      <section className="rounded-xl border border-slate-200 bg-white p-8 print:border-0 print:p-0">
        <div className="mb-6 border-b border-slate-200 pb-4">
          <h2 className="text-xl font-semibold text-slate-900">
            {pool.name} — Chamada de capital
          </h2>
          <p className="mt-1 text-sm text-slate-500">
            {pool.code}
            {pool.alias ? ` · projeto ${pool.alias}` : ""} · emitida em {fmtDate(call.date)}
          </p>
        </div>

        <div className="mb-6 grid grid-cols-3 gap-6">
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">Valor total da chamada</div>
            <div className="text-2xl font-semibold tabular-nums text-slate-900">
              {formatMoney(call.totalAmount, cur)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">Recebido até agora</div>
            <div className="text-2xl font-semibold tabular-nums text-slate-900">{formatMoney(receivedTotal, cur)}</div>
            <div className="text-xs text-slate-500">
              {unitsIssued ? `${unitsIssued.toFixed(4)} units emitidas` : "nenhuma unit emitida"}
              {paid > 0 && Math.abs(gap) >= 0.01 ? (gap > 0 ? ` · faltam ${formatMoney(gap, cur)}` : ` · ${formatMoney(-gap, cur)} acima do chamado`) : ""}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-slate-400">Motivo</div>
            <div className="text-sm font-medium text-slate-800">{call.reason}</div>
            {call.memo && <div className="text-xs text-slate-500">{call.memo}</div>}
          </div>
        </div>

        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium uppercase tracking-wide text-slate-400">
              <th className="py-2">Sócio</th>
              <th className="py-2 text-right">Participação</th>
              <th className="py-2 text-right">Pro rata</th>
              <th className="py-2 text-right">Recebido</th>
              <th className="py-2 text-right">Units</th>
              <th className="py-2 text-right">Status</th>
              <th className="py-2 text-right print:hidden"></th>
            </tr>
          </thead>
          <tbody>
            {call.lines
              .sort((a, b) => Number(b.amount) - Number(a.amount))
              .map((l) => {
                const [label, cls] = statusOf(l);
                const r = l.receivedAmount != null ? Number(l.receivedAmount) : null;
                return (
                  <tr key={l.id} className="border-b border-slate-100">
                    <td className="py-2.5 text-sm font-medium text-slate-800">{memberName(l.member)}</td>
                    <td className="py-2.5 text-right text-sm tabular-nums text-slate-600">{pctOf(l.amount)}%</td>
                    <td className="py-2.5 text-right text-sm tabular-nums text-slate-700">{formatMoney(l.amount, cur)}</td>
                    <td className="py-2.5 text-right text-sm font-medium tabular-nums text-slate-900">
                      {r != null ? formatMoney(r, cur) : "—"}
                      {l.paidAt && <div className="text-[10.5px] font-normal text-slate-400">{fmtDate(l.paidAt)}</div>}
                    </td>
                    <td className="py-2.5 text-right text-sm tabular-nums text-slate-600">
                      {r ? (r / Number(pool.unitPrice)).toFixed(4) : "—"}
                    </td>
                    <td className="py-2.5 text-right text-sm">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs ${cls}`}>{label}</span>
                    </td>
                    <td className="py-2.5 text-right print:hidden">
                      {!l.paid && (
                        <form action={registerCallPayment} className="flex items-center justify-end gap-1.5">
                          <input type="hidden" name="lineId" value={l.id} />
                          <input
                            name="amount"
                            defaultValue={Number(l.amount).toFixed(2)}
                            title="Valor recebido (pode ser parcial ou acima do pro rata)"
                            className="w-24 rounded border border-slate-300 px-2 py-1 text-right text-xs tabular-nums"
                          />
                          <input name="date" type="date" className="rounded border border-slate-300 px-2 py-1 text-xs" />
                          <button
                            type="submit"
                            className="rounded bg-[#1f3a5f] px-2 py-1 text-xs font-medium text-white hover:bg-[#16304f]"
                          >
                            Recebido
                          </button>
                          {/* botão com nome próprio: o input "amount" acima também vai no form
                              e formData.get pegaria o primeiro */}
                          <button
                            type="submit"
                            name="waive"
                            value="1"
                            title="Marca que o sócio não participou desta chamada (sem aporte, sem units)"
                            className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-500 hover:bg-slate-50"
                          >
                            Não participa
                          </button>
                        </form>
                      )}
                    </td>
                  </tr>
                );
              })}
            <tr>
              <td className="py-2.5 text-sm font-semibold text-slate-900">Total</td>
              <td className="py-2.5 text-right text-sm font-semibold tabular-nums">100.00%</td>
              <td className="py-2.5 text-right text-sm font-semibold tabular-nums text-slate-900">
                {formatMoney(call.totalAmount, cur)}
              </td>
              <td className="py-2.5 text-right text-sm font-semibold tabular-nums text-slate-900">
                {formatMoney(receivedTotal, cur)}
              </td>
              <td className="py-2.5 text-right text-sm font-semibold tabular-nums text-slate-700">
                {unitsIssued ? unitsIssued.toFixed(4) : "—"}
              </td>
              <td className="py-2.5 text-right text-xs text-slate-500">
                {paid}/{call.lines.length} registrados
              </td>
              <td className="print:hidden"></td>
            </tr>
          </tbody>
        </table>

        <p className="mt-6 text-xs leading-relaxed text-slate-400">
          Chamada de capital proporcional às units detidas na data de emissão, conforme o
          operating agreement do {pool.name}. Os valores efetivamente aportados emitem units ao preço de{" "}
          {formatMoney(pool.unitPrice, cur)} e integram a base de capital do sócio para fins de retorno e
          distribuição; quem aporta acima do seu pro rata amplia a sua participação na mesma proporção.
        </p>
      </section>
    </div>
  );
}
