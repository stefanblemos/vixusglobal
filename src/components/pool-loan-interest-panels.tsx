"use client";

import { useActionState } from "react";
import { launchLoanCharge, payLoanInterest, type FormState } from "@/lib/actions/pool-loan";

/**
 * Painéis do Statement (mock aprovado 17/07):
 * 1) Cobranças do contrato ainda não lançadas — a leitura dos documentos acha os fees e o
 *    crédito do closing; financiado vira DÍVIDA, em caixa vira despesa do pool. O funded
 *    do banco costuma EMBUTIR fees + crédito — o painel compõe o saldo, não soma por cima.
 * 2) Juros período a período — esperado × cobrado, vencimento (dia/grace/multa do contrato)
 *    e status, com "registrar pagamento".
 */

export type ChargeCandidate = {
  key: string;
  name: string;
  source: string; // «arquivo»
  date: string; // yyyy-mm-dd
  amountFmt: string;
  amount: number;
  target: "DEBT" | "CREDIT_IN" | "EXPENSE";
};

export type InterestRow = {
  label: string;
  baseFmt: string | null;
  expectedFmt: string;
  chargedFmt: string | null;
  paidFmt: string | null; // pagamentos alocados a este período
  dueDate: string; // MM/DD/YYYY
  dDays: number | null; // dias até o vencimento (negativo = passou)
  status: "pago" | "devido" | "vencido" | "corrente" | "previsto";
  owed: number; // o que FALTA pagar do período (owed − paid)
};

const th = "px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-slate-400";
const thRight = "px-3 py-2 text-right text-[10px] font-medium uppercase tracking-wide text-slate-400";
const tdRight = "px-3 py-2 text-right text-sm tabular-nums text-slate-700";

function ChargeRow({ poolId, loanId, c }: { poolId: string; loanId: string; c: ChargeCandidate }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    launchLoanCharge.bind(null, poolId),
    undefined,
  );
  const label =
    c.target === "DEBT" ? "Lançar como dívida" : c.target === "CREDIT_IN" ? "Lançar (compõe o saldo)" : "Lançar como despesa do pool";
  return (
    <tr className="border-b border-amber-100/60">
      <td className="px-3 py-2 text-sm text-slate-700">
        {c.name} <span className="text-[10.5px] text-slate-400">· {c.source}</span>
      </td>
      <td className="px-3 py-2 text-xs text-slate-500">{c.date.slice(5, 7)}/{c.date.slice(8, 10)}/{c.date.slice(0, 4)}</td>
      <td className={tdRight}>{c.amountFmt}</td>
      <td className="px-3 py-2">
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] ${
            c.target === "DEBT"
              ? "bg-slate-100 text-slate-600"
              : c.target === "CREDIT_IN"
                ? "bg-blue-50 text-blue-700"
                : "bg-amber-100 text-amber-800"
          }`}
        >
          {c.target === "DEBT" ? "financiado" : c.target === "CREDIT_IN" ? "crédito do closing" : "em caixa"}
        </span>
      </td>
      <td className="px-3 py-2 text-right">
        <form action={action}>
          <input type="hidden" name="loanId" value={loanId} />
          <input type="hidden" name="amount" value={c.amount} />
          <input type="hidden" name="date" value={c.date} />
          <input type="hidden" name="memo" value={`${c.name} — ${c.source}`} />
          <input type="hidden" name="target" value={c.target} />
          <button
            type="submit"
            disabled={pending}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
              c.target === "EXPENSE"
                ? "border border-slate-300 text-slate-600 hover:border-slate-400"
                : "bg-[#1f3a5f] text-white hover:bg-[#16304f]"
            }`}
          >
            {pending ? "Lançando…" : label}
          </button>
          {state?.error && <p className="mt-1 text-[10px] text-red-600">{state.error}</p>}
        </form>
      </td>
    </tr>
  );
}

export function LoanChargesPanel({
  poolId,
  loanId,
  candidates,
  fundedNote,
}: {
  poolId: string;
  loanId: string;
  candidates: ChargeCandidate[];
  fundedNote: string | null;
}) {
  if (candidates.length === 0) return null;
  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
      <p className="text-sm font-semibold text-amber-900">
        ⚠ Cobranças do contrato ainda não lançadas
      </p>
      <p className="mb-2 text-xs text-amber-800/80">
        Achadas na leitura dos documentos e ausentes do statement. Atenção: o valor sacado do
        banco normalmente JÁ EMBUTE os fees financiados e o crédito devolvido no closing — estas
        linhas compõem esse saldo (não somam por cima).{fundedNote ? ` ${fundedNote}` : ""}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-amber-200/60">
              <th className={th}>Cobrança (fonte)</th>
              <th className={th}>Data</th>
              <th className={thRight}>Valor</th>
              <th className={th}>Destino</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {candidates.map((c) => (
              <ChargeRow key={c.key} poolId={poolId} loanId={loanId} c={c} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PayButton({ poolId, loanId, amount, memo }: { poolId: string; loanId: string; amount: number; memo: string }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    payLoanInterest.bind(null, poolId),
    undefined,
  );
  return (
    <form action={action} className="inline">
      <input type="hidden" name="loanId" value={loanId} />
      <input type="hidden" name="amount" value={amount} />
      <input type="hidden" name="memo" value={memo} />
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-[#1f3a5f] hover:border-slate-400 disabled:opacity-50"
        title="Cria o INTEREST_PAYMENT no statement (sai do caixa do pool)"
      >
        {pending ? "pagando…" : `pagar $${amount.toLocaleString("en-US")}`}
      </button>
      {state?.error && <span className="ml-1 text-[10px] text-red-600">{state.error}</span>}
    </form>
  );
}

export function LoanInterestPanel({
  poolId,
  loanId,
  rows,
  ruleText,
  footNote,
}: {
  poolId: string;
  loanId: string;
  rows: InterestRow[];
  ruleText: string;
  footNote: string | null;
}) {
  if (rows.length === 0) return null;
  const chip = (s: InterestRow["status"]) =>
    s === "pago" ? (
      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-semibold text-emerald-700">pago ✓</span>
    ) : s === "vencido" ? (
      <span className="rounded-full bg-red-50 px-2 py-0.5 text-[10.5px] font-semibold text-red-700">vencido ⚠</span>
    ) : s === "devido" ? (
      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-semibold text-amber-700">devido</span>
    ) : s === "corrente" ? (
      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10.5px] text-blue-700">corrente</span>
    ) : (
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10.5px] text-slate-500">previsto</span>
    );
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-3">
        <h2 className="text-base font-medium text-slate-800">Juros — período a período</h2>
        <p className="text-xs text-slate-400">{ruleText}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className={th}>Período</th>
              <th className={thRight}>Saldo base</th>
              <th className={thRight}>Esperado</th>
              <th className={thRight}>Cobrado</th>
              <th className={thRight}>Pago</th>
              <th className={th}>Vencimento</th>
              <th className={th}>Status</th>
              <th className={th}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className="border-b border-slate-50">
                <td className="px-3 py-2 text-sm text-slate-700">{r.label}</td>
                <td className={tdRight}>{r.baseFmt ?? "—"}</td>
                <td className={tdRight}>{r.expectedFmt}</td>
                <td className={tdRight}>{r.chargedFmt ?? "—"}</td>
                <td className={`${tdRight} text-emerald-700`}>{r.paidFmt ?? "—"}</td>
                <td className="px-3 py-2 text-sm tabular-nums text-slate-700">
                  {r.status === "devido" || r.status === "vencido" ? <b>{r.dueDate}</b> : r.dueDate}
                  {r.dDays != null && (r.status === "devido" || r.status === "vencido") && (
                    <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-[9.5px] font-bold ${r.dDays < 0 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"}`}>
                      {r.dDays < 0 ? `+${-r.dDays}d` : `D-${r.dDays}`}
                    </span>
                  )}
                </td>
                <td className="px-3 py-2">{chip(r.status)}</td>
                <td className="px-3 py-2 text-right">
                  {(r.status === "devido" || r.status === "vencido") && r.owed > 0 && (
                    <PayButton poolId={poolId} loanId={loanId} amount={r.owed} memo={`Pagamento de juros — ${r.label}`} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {footNote && (
        <p className="border-t border-slate-100 px-5 py-2.5 text-[11px] text-slate-400">{footNote}</p>
      )}
    </section>
  );
}
