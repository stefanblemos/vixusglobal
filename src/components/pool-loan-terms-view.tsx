"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { saveLoanTermsFull, type FormState } from "@/lib/actions/pool-loan";

/**
 * Aba TERMOS (mock aprovado 17/07): todos os campos extraídos do LOI, visíveis e
 * TRAVADOS. "Editar" libera tudo para corrigir erros de leitura da AI. As condições
 * do banco atualizam o PERFIL do banco (valem p/ simulações e outros pools).
 */

export type LoanTermsData = {
  loanId: string;
  bankProfileId: string | null;
  loanNumber: string | null;
  committed: string | null; // valor cru p/ input
  committedFmt: string | null; // formatado p/ exibição
  aprPct: string | null;
  firstContactDate: string | null; // yyyy-mm-dd
  expectedClosingDate: string | null;
  closingDate: string | null;
  interestDueDay: string | null; // dia do vencimento do juro mensal
  graceDays: string | null;
  lateFeePct: string | null;
  feesInEnvelope: "IN" | "OUT" | ""; // modalidade: fees por dentro do teto | por fora | indefinida
  notes: string | null;
  statusChip: { text: string; tone: "amber" | "green" | "slate" };
  sourceChip: string | null; // "preenchido do LOI de … · leitura por AI"
  contractText: string | null; // "18d em curso" / "contratado em 45d"
};

export type BankTermsData = {
  rateText: string; // "9,000% fixa"
  basisText: string; // "sobre o sacado (non-Dutch)"
  termMonths: number;
  extensionMonths: number;
  ltcBuildPct: string;
  ltvPct: string;
  originationPct: string;
  brokerPct: string;
  processingFee: string;
  appraisalFee: string;
  legalFee: string;
  budgetReviewFee: string;
  inspectionFeePerDraw: string;
  feesFinanced: boolean;
  reserveText: string; // "liquidez exigida (não financiada)" / "financiada (6m)"
  reserveMonths: string;
  customFees: Array<{ name: string; amount: string }>;
};

export type LoiInfoData = { loiDate: string | null; prepayment: string | null };

const label = "block text-[10.5px] text-slate-400";
const value = "border-b border-dashed border-slate-200 py-1 text-[13px] font-semibold text-slate-900";
const valueDim = "border-b border-dashed border-slate-200 py-1 text-[13px] text-slate-400";
const inputClass =
  "w-full rounded-lg border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const groupLabel =
  "mb-2 mt-5 text-[10px] font-bold uppercase tracking-widest text-slate-400 first:mt-0";

function Field({ l, v, dim }: { l: string; v: string | null; dim?: boolean }) {
  return (
    <div>
      <span className={label}>{l}</span>
      <div className={dim || !v ? valueDim : value}>{v ?? "—"}</div>
    </div>
  );
}

function EditField({
  l,
  name,
  defaultValue,
  type = "text",
}: {
  l: string;
  name: string;
  defaultValue: string | null;
  type?: string;
}) {
  return (
    <div>
      <span className={label}>{l}</span>
      <input name={name} type={type} defaultValue={defaultValue ?? ""} className={inputClass} />
    </div>
  );
}

export function PoolLoanTermsView({
  poolId,
  loan,
  bank,
  loi,
  banks,
}: {
  poolId: string;
  loan: LoanTermsData;
  bank: BankTermsData | null;
  loi: LoiInfoData | null;
  banks: Array<{ id: string; name: string }>;
}) {
  const [editing, setEditing] = useState(false);
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    saveLoanTermsFull.bind(null, poolId),
    undefined,
  );
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);

  const tone =
    loan.statusChip.tone === "green"
      ? "bg-emerald-50 text-emerald-700"
      : loan.statusChip.tone === "amber"
        ? "bg-amber-50 text-amber-700"
        : "bg-slate-100 text-slate-500";

  const fmtBr = (iso: string | null) =>
    iso ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : null;

  if (editing) {
    return (
      <section className="rounded-xl border border-slate-200 bg-white p-5">
        <form action={formAction}>
          <input type="hidden" name="loanId" value={loan.loanId} />
          <input type="hidden" name="bankFeesFinancedSent" value="1" />
          <div className="mb-1 flex items-center gap-2">
            <h2 className="text-base font-medium text-slate-800">Termos — modo edição</h2>
            <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10.5px] text-blue-700">
              corrija erros de leitura da AI e salve
            </span>
          </div>
          <p className="mb-4 text-xs text-slate-400">
            As condições do banco atualizam o perfil do banco — valem também para simulações e
            outros pools deste banco. Campos de condição deixados em branco não são alterados.
          </p>

          <div className={groupLabel}>Loan</div>
          <div className="grid grid-cols-2 gap-x-5 gap-y-3 md:grid-cols-5">
            <div>
              <span className={label}>Banco</span>
              <select name="bankProfileId" defaultValue={loan.bankProfileId ?? ""} className={inputClass}>
                <option value="">—</option>
                {banks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </div>
            <EditField l="Loan #" name="loanNumber" defaultValue={loan.loanNumber} />
            <EditField l="Comprometido" name="committed" defaultValue={loan.committed} />
            <EditField l="Taxa (APR %)" name="aprPct" defaultValue={loan.aprPct} />
            <div />
            <EditField l="Solicitação do LOI" name="firstContactDate" type="date" defaultValue={loan.firstContactDate} />
            <EditField l="Closing previsto" name="expectedClosingDate" type="date" defaultValue={loan.expectedClosingDate} />
            <EditField l="Closing real" name="closingDate" type="date" defaultValue={loan.closingDate} />
            <EditField l="Vencimento do juro (dia)" name="interestDueDay" defaultValue={loan.interestDueDay} />
            <EditField l="Grace (dias)" name="graceDays" defaultValue={loan.graceDays} />
            <EditField l="Multa por atraso %" name="lateFeePct" defaultValue={loan.lateFeePct} />
            <div>
              <span className={label}>Fees do closing (modalidade)</span>
              <select name="feesInEnvelope" defaultValue={loan.feesInEnvelope} className={inputClass}>
                <option value="">— indefinida</option>
                <option value="IN">por dentro do teto (net funding)</option>
                <option value="OUT">por fora — somam ao comprometido</option>
              </select>
            </div>
          </div>

          {bank && (
            <>
              <div className={groupLabel}>Condições do banco (perfil)</div>
              <div className="grid grid-cols-2 gap-x-5 gap-y-3 md:grid-cols-5">
                <EditField l="Max LTC %" name="bankLtc" defaultValue={bank.ltcBuildPct} />
                <EditField l="Max LARV %" name="bankLtv" defaultValue={bank.ltvPct} />
                <EditField l="Origination %" name="bankOrigination" defaultValue={bank.originationPct} />
                <EditField l="Broker %" name="bankBroker" defaultValue={bank.brokerPct} />
                <EditField l="Draw fee ($/inspeção)" name="bankDrawFee" defaultValue={bank.inspectionFeePerDraw} />
                <EditField l="Processing $" name="bankProcessing" defaultValue={bank.processingFee} />
                <EditField l="Appraisal $" name="bankAppraisal" defaultValue={bank.appraisalFee} />
                <EditField l="Legal $" name="bankLegal" defaultValue={bank.legalFee} />
                <EditField l="Feasibility $" name="bankFeasibility" defaultValue={bank.budgetReviewFee} />
                <EditField l="Reserve (meses)" name="bankReserveMonths" defaultValue={bank.reserveMonths} />
                <EditField l="Prazo (meses)" name="bankTermMonths" defaultValue={String(bank.termMonths)} />
                <EditField l="Extensão (meses)" name="bankExtensionMonths" defaultValue={String(bank.extensionMonths)} />
                <div className="flex items-end pb-1.5">
                  <label className="flex items-center gap-2 text-xs text-slate-600">
                    <input type="checkbox" name="bankFeesFinanced" defaultChecked={bank.feesFinanced} />
                    fees financiados no loan
                  </label>
                </div>
              </div>
            </>
          )}

          <div className={groupLabel}>Notas</div>
          <input name="notes" defaultValue={loan.notes ?? ""} className={inputClass} />

          <div className="mt-4 flex items-center gap-2">
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
            >
              {pending ? "Salvando…" : "Salvar"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:border-slate-400"
            >
              Cancelar
            </button>
            {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
          </div>
        </form>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <h2 className="text-base font-medium text-slate-800">Termos</h2>
        {loan.sourceChip && (
          <span className="rounded-full bg-blue-50 px-2.5 py-0.5 text-[10.5px] text-blue-700">
            {loan.sourceChip}
          </span>
        )}
        <span className={`rounded-full px-2.5 py-0.5 text-[10.5px] ${tone}`}>{loan.statusChip.text}</span>
        <button
          onClick={() => setEditing(true)}
          className="ml-auto rounded-lg border border-slate-300 px-3.5 py-1.5 text-sm font-medium text-[#1f3a5f] hover:border-slate-400"
        >
          ✎ Editar
        </button>
      </div>
      <p className="mb-4 text-xs text-slate-400">
        Campos travados — preenchidos pela leitura do LOI e pelos documentos. “Editar” libera tudo
        para corrigir erros de leitura.
      </p>

      <div className={groupLabel}>Loan</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-5">
        <Field l="Loan #" v={loan.loanNumber} />
        <Field l="Comprometido" v={loan.committedFmt} />
        <Field l="Taxa" v={loan.aprPct ? `${loan.aprPct}% · ${bank?.rateText ?? ""}`.trim() : bank?.rateText ?? null} />
        <Field l="Base de juros" v={bank?.basisText ?? null} />
        <Field l="Prazo" v={bank ? `${bank.termMonths} meses${bank.extensionMonths > 0 ? ` + ext. ${bank.extensionMonths}m` : ""}` : null} />
        <Field l="Reserve de juros" v={bank?.reserveText ?? null} />
        <Field l="Fees financiados?" v={bank ? (bank.feesFinanced ? "sim — no envelope do loan" : "não — em caixa no closing") : null} />
        <Field l="Prepayment" v={loi?.prepayment ?? null} dim={!loi?.prepayment} />
      </div>

      <div className={groupLabel}>Datas &amp; celeridade</div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-5">
        <Field l="Solicitação do LOI" v={fmtBr(loan.firstContactDate)} />
        <Field l="LOI emitido" v={fmtBr(loi?.loiDate ?? null)} />
        <Field l="Closing previsto" v={fmtBr(loan.expectedClosingDate)} />
        <Field l="Closing real" v={fmtBr(loan.closingDate)} />
        <Field l="Contratação" v={loan.contractText} />
        <Field
          l="Vencimento do juro"
          v={
            loan.interestDueDay
              ? `dia ${loan.interestDueDay}${loan.graceDays ? ` · grace ${loan.graceDays}d` : ""}${loan.lateFeePct ? ` · multa ${loan.lateFeePct}%` : ""}`
              : null
          }
        />
        <Field
          l="Fees do closing (modalidade)"
          v={
            loan.feesInEnvelope === "IN"
              ? "por dentro do teto (consomem o envelope)"
              : loan.feesInEnvelope === "OUT"
                ? "por fora (somam ao comprometido)"
                : null
          }
          dim={loan.feesInEnvelope === ""}
        />
      </div>

      {bank && (
        <>
          <div className={groupLabel}>Condições do banco (LOI → perfil do banco)</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-5">
            <Field l="Max LTC" v={`${bank.ltcBuildPct}%`} />
            <Field l="Max LARV" v={`${bank.ltvPct}%`} />
            <Field l="Origination" v={`${bank.originationPct}%`} />
            <Field l="Broker" v={`${bank.brokerPct}%`} />
            <Field l="Draw fee" v={`$${bank.inspectionFeePerDraw} / inspeção`} />
            <Field l="Processing" v={`$${bank.processingFee}`} />
            <Field l="Appraisal" v={`$${bank.appraisalFee}`} />
            <Field l="Legal" v={`$${bank.legalFee}`} />
            <Field l="Feasibility" v={`$${bank.budgetReviewFee}`} />
            {bank.customFees.map((f) => (
              <Field key={f.name} l={f.name} v={`$${f.amount}`} />
            ))}
          </div>
        </>
      )}

      {loan.notes && (
        <>
          <div className={groupLabel}>Notas</div>
          <p className="text-xs leading-relaxed text-slate-500">{loan.notes}</p>
        </>
      )}

      <div className="mt-5 rounded-lg bg-slate-50 px-4 py-2.5 text-[11.5px] text-slate-500">
        🔒 Travado para edição. <b>Editar</b> libera os campos. As <b>condições do banco</b>{" "}
        atualizam o perfil do banco — valem também para simulações e outros pools deste banco.
      </div>
    </section>
  );
}
