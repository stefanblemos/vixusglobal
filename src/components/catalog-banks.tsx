"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import {
  deleteBankCustomFee,
  deleteBankProfile,
  saveBankCustomFee,
  saveBankProfile,
  type CatalogFormState,
} from "@/lib/actions/catalog";
import type { HistoryEntry } from "@/components/catalog-locations";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";
const hintClass = "mt-1 text-[11px] leading-snug text-slate-400";
const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-2.5 text-sm text-slate-600";

export type BankFeeRow = {
  id: string;
  name: string;
  timing: string;
  kind: string;
  amount: string;
};

export type BankRow = {
  id: string;
  name: string;
  ltcBuildPct: string;
  ltcLandPct: string;
  financeLand: boolean;
  ltvPct: string;
  haircutPct: string;
  perUnitCap: string | null;
  closingPermitPct: string;
  rateType: string;
  aprPct: string;
  indexPct: string;
  spreadPct: string;
  interestBasis: string;
  originationPct: string;
  originationFlat: string;
  brokerPct: string;
  titleEscrowPct: string;
  closingFeePct: string;
  processingFee: string;
  budgetReviewFee: string;
  appraisalFee: string;
  legalFee: string;
  feesFinanced: boolean;
  servicingMonthly: string;
  inspectionFeePerDraw: string;
  drawProcessingFee: string;
  achFeePerBatch: string;
  hasInterestReserve: boolean;
  reserveMonths: string;
  releaseMode: string;
  sweepPct: string;
  reconveyanceFee: string;
  termMonths: string;
  extensionMonths: string;
  extensionFeePct: string;
  notes: string | null;
  customFees: BankFeeRow[];
};

const TIMING_LABEL: Record<string, string> = {
  CLOSING: "No closing",
  PER_DRAW: "Por draw",
  PER_DRAW_BATCH: "Por lote de draws",
  MONTHLY: "Por mês",
  PER_PAYOFF: "Por payoff",
  FINAL: "Na reconciliação final",
};

const KIND_LABEL: Record<string, string> = {
  FLAT: "Fixo $",
  PCT_COMMITTED: "% do comprometido",
  PCT_PAYOFF: "% do payoff",
};

const effectiveApr = (b: BankRow) =>
  b.rateType === "FIXED" ? Number(b.aprPct) : Number(b.indexPct) + Number(b.spreadPct);

function Field({
  name,
  label,
  value,
  hint,
}: {
  name: string;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input name={name} defaultValue={value} className={inputClass} />
      {hint && <p className={hintClass}>{hint}</p>}
    </div>
  );
}

function CustomFees({ bank }: { bank: BankRow }) {
  const [state, formAction, pending] = useActionState<CatalogFormState, FormData>(
    saveBankCustomFee,
    undefined,
  );
  return (
    <div>
      <h4 className="text-sm font-semibold text-slate-700">Taxas específicas deste banco</h4>
      <p className="mb-2 text-xs text-slate-400">
        O que não se encaixa nos campos padrão. Valor negativo = crédito (ex.: LO credit).
      </p>
      {bank.customFees.length > 0 && (
        <div className="mb-2 space-y-1">
          {bank.customFees.map((f) => (
            <div key={f.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
              <span className="font-medium text-slate-700">{f.name}</span>
              <span className="flex items-center gap-3 text-xs text-slate-500">
                {TIMING_LABEL[f.timing] ?? f.timing} · {KIND_LABEL[f.kind] ?? f.kind} ·{" "}
                <span className={Number(f.amount) < 0 ? "text-emerald-700" : ""}>
                  {Number(f.amount) < 0 ? "−" : ""}${Math.abs(Number(f.amount)).toLocaleString("en-US")}
                  {f.kind !== "FLAT" ? "%" : ""}
                </span>
                <form action={deleteBankCustomFee} className="inline">
                  <input type="hidden" name="feeId" value={f.id} />
                  <button type="submit" className="text-slate-300 hover:text-red-500">✕</button>
                </form>
              </span>
            </div>
          ))}
        </div>
      )}
      <form action={formAction} className="flex flex-wrap items-end gap-2">
        <input type="hidden" name="bankProfileId" value={bank.id} />
        <div className="min-w-36 flex-1">
          <label className={labelClass}>Nome</label>
          <input name="feeName" required placeholder="Flood cert" className={inputClass} />
        </div>
        <div className="w-44">
          <label className={labelClass}>Quando cobra</label>
          <select name="timing" defaultValue="CLOSING" className={inputClass}>
            {Object.entries(TIMING_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="w-44">
          <label className={labelClass}>Como</label>
          <select name="kind" defaultValue="FLAT" className={inputClass}>
            {Object.entries(KIND_LABEL).map(([v, l]) => (
              <option key={v} value={v}>{l}</option>
            ))}
          </select>
        </div>
        <div className="w-28">
          <label className={labelClass}>Valor</label>
          <input name="amount" required className={inputClass} />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
        >
          {pending ? "Adding…" : "+ Add"}
        </button>
        {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      </form>
    </div>
  );
}

function BankModal({
  bank,
  history,
  onClose,
}: {
  bank: BankRow | null;
  history: HistoryEntry[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<CatalogFormState, FormData>(
    saveBankProfile,
    undefined,
  );
  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);
  const [rateType, setRateType] = useState(bank?.rateType ?? "FIXED");
  const [releaseMode, setReleaseMode] = useState(bank?.releaseMode ?? "SWEEP_FULL");
  const [hasReserve, setHasReserve] = useState(bank?.hasInterestReserve ?? false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6"
      onClick={onClose}
    >
      <div className="w-full max-w-3xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-800">{bank ? bank.name : "New bank"}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        <form action={formAction} className="space-y-5 px-6 py-4">
          {bank && <input type="hidden" name="id" value={bank.id} />}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Bank name *</label>
              <input name="name" required defaultValue={bank?.name ?? ""} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Notes</label>
              <input name="notes" defaultValue={bank?.notes ?? ""} className={inputClass} />
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-700">1 · Dimensionamento</h4>
            <p className="mb-2 text-xs text-slate-400">Quanto o banco empresta por casa: min(LTC, LTV, cap).</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
              <Field name="ltcBuildPct" label="LTC obra %" value={bank?.ltcBuildPct ?? "80"} />
              <Field name="ltcLandPct" label="LTC lote %" value={bank?.ltcLandPct ?? "50"} />
              <Field name="ltvPct" label="LTV %" value={bank?.ltvPct ?? "70"} />
              <Field name="haircutPct" label="Haircut %" value={bank?.haircutPct ?? "5"} hint="Desconto sobre o ARV avaliado" />
              <Field name="perUnitCap" label="Cap por casa" value={bank?.perUnitCap ?? ""} hint="Vazio = sem cap" />
              <Field
                name="closingPermitPct"
                label="Closing com % permits"
                value={bank?.closingPermitPct ?? "80"}
                hint="Banco autoriza o closing com X% dos permits emitidos (10 casas a 80% → 8º permit)"
              />
            </div>
            <label className="mt-1 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="financeLand" defaultChecked={bank?.financeLand ?? false} /> financia o lote
            </label>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-700">2 · Juros</h4>
            <p className="mb-2 text-xs text-slate-400">
              Non-Dutch = juro só sobre o sacado; Dutch = sobre o total comprometido desde o dia 1.
            </p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <label className={labelClass}>Tipo de taxa</label>
                <select name="rateType" value={rateType} onChange={(e) => setRateType(e.target.value)} className={inputClass}>
                  <option value="FIXED">Fixa</option>
                  <option value="PRIME_SPREAD">Prime + spread</option>
                  <option value="SOFR_SPREAD">SOFR + spread</option>
                </select>
              </div>
              {rateType === "FIXED" ? (
                <Field name="aprPct" label="APR %" value={bank?.aprPct ?? "9"} />
              ) : (
                <>
                  <Field name="indexPct" label="Índice hoje %" value={bank?.indexPct ?? "7.5"} />
                  <Field name="spreadPct" label="Spread %" value={bank?.spreadPct ?? "1"} />
                </>
              )}
              <div>
                <label className={labelClass}>Base de cobrança</label>
                <select name="interestBasis" defaultValue={bank?.interestBasis ?? "DRAWN"} className={inputClass}>
                  <option value="DRAWN">Saldo sacado (non-Dutch)</option>
                  <option value="COMMITTED">Comprometido (Dutch)</option>
                </select>
              </div>
            </div>
            {rateType === "FIXED" ? (
              <input type="hidden" name="indexPct" value={bank?.indexPct ?? "0"} />
            ) : (
              <input type="hidden" name="aprPct" value={bank?.aprPct ?? "0"} />
            )}
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-700">3 · No closing</h4>
            <p className="mb-2 text-xs text-slate-400">Pagos uma vez na abertura. Vazio/0 = banco não cobra.</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field name="originationPct" label="Origination %" value={bank?.originationPct ?? "1"} hint="Pontos, % do comprometido" />
              <Field name="originationFlat" label="Origination flat $" value={bank?.originationFlat ?? "0"} />
              <Field name="brokerPct" label="Broker %" value={bank?.brokerPct ?? "0"} />
              <Field name="titleEscrowPct" label="Title & escrow %" value={bank?.titleEscrowPct ?? "0"} />
              <Field name="closingFeePct" label="Outros closing %" value={bank?.closingFeePct ?? "0"} />
              <Field name="processingFee" label="Processing $" value={bank?.processingFee ?? "0"} />
              <Field name="budgetReviewFee" label="Budget review $" value={bank?.budgetReviewFee ?? "0"} />
              <Field name="appraisalFee" label="Appraisal $" value={bank?.appraisalFee ?? "0"} />
              <Field name="legalFee" label="Legal $" value={bank?.legalFee ?? "0"} />
            </div>
            <label className="mt-1 flex items-center gap-2 text-sm text-slate-600">
              <input type="checkbox" name="feesFinanced" defaultChecked={bank?.feesFinanced ?? true} /> fees financiados no
              loan (senão saem do caixa do pool no closing)
            </label>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-700">4 · Durante a obra</h4>
            <p className="mb-2 text-xs text-slate-400">Recorrentes — capitalizam no saldo do loan.</p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field name="servicingMonthly" label="Servicing $/mês" value={bank?.servicingMonthly ?? "0"} />
              <Field name="inspectionFeePerDraw" label="Inspection $/draw" value={bank?.inspectionFeePerDraw ?? "0"} />
              <Field name="drawProcessingFee" label="Processing $/draw" value={bank?.drawProcessingFee ?? "0"} />
              <Field name="achFeePerBatch" label="ACH $/lote de draws" value={bank?.achFeePerBatch ?? "0"} hint="Cobrado por data com draws" />
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                name="hasInterestReserve"
                checked={hasReserve}
                onChange={(e) => setHasReserve(e.target.checked)}
              />{" "}
              interest reserve (financiada no closing; paga o juro do mês; não usada volta na reconciliação)
            </label>
            {hasReserve && (
              <div className="mt-2 w-48">
                <Field name="reserveMonths" label="Reserve (meses de juro)" value={bank?.reserveMonths ?? "6"} hint="Sobre o comprometido — BC usa 6" />
              </div>
            )}
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-700">5 · Na venda / payoff</h4>
            <div className="mt-2 grid grid-cols-2 gap-4 md:grid-cols-4">
              <div>
                <label className={labelClass}>Release</label>
                <select
                  name="releaseMode"
                  value={releaseMode}
                  onChange={(e) => setReleaseMode(e.target.value)}
                  className={inputClass}
                >
                  <option value="SWEEP_FULL">100% do líquido até quitar</option>
                  <option value="SWEEP_PCT_LAST_FULL">Sweep % + quitação na última</option>
                </select>
              </div>
              {releaseMode === "SWEEP_PCT_LAST_FULL" ? (
                <Field name="sweepPct" label="Sweep %" value={bank?.sweepPct ?? "85"} hint="% do líquido nas vendas antes da última" />
              ) : (
                <input type="hidden" name="sweepPct" value={bank?.sweepPct ?? "100"} />
              )}
              <Field name="reconveyanceFee" label="Reconveyance $/payoff" value={bank?.reconveyanceFee ?? "0"} hint="Release da casa (BC: $350)" />
            </div>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-slate-700">6 · Prazo</h4>
            <p className="mb-2 text-xs text-slate-400">
              Extensão: deve &gt;50% do original → % sobre TODO o financiado; senão só sobre o saldo.
              Aplicada apenas no cenário Conservador.
            </p>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              <Field name="termMonths" label="Term (meses)" value={bank?.termMonths ?? "12"} />
              <Field name="extensionMonths" label="Extensão (meses)" value={bank?.extensionMonths ?? "6"} />
              <Field name="extensionFeePct" label="Extension fee %" value={bank?.extensionFeePct ?? "1"} />
            </div>
          </div>

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <div className="flex items-center justify-between pt-1">
            {bank ? (
              <button
                type="submit"
                formAction={deleteBankProfile}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
              >
                Delete bank
              </button>
            ) : (
              <span />
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>

        {bank && (
          <div className="border-t border-slate-100 px-6 py-4">
            <CustomFees bank={bank} />
          </div>
        )}

        {bank && (
          <div className="border-t border-slate-100 px-6 py-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Change history</h4>
            {history.length === 0 ? (
              <p className="text-xs text-slate-400">No changes recorded yet.</p>
            ) : (
              <div className="max-h-48 space-y-2 overflow-y-auto pr-2">
                {history.map((h, i) => (
                  <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>
                        {h.action === "CREATE" ? "Created" : h.action === "DELETE" ? "Deleted" : "Updated"} by{" "}
                        <span className="font-medium text-slate-600">{h.changedBy}</span>
                      </span>
                      <span>{new Date(h.createdAt).toLocaleString("en-US")}</span>
                    </div>
                    {h.changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-slate-600">
                        {h.changes.map((c, j) => (
                          <li key={j}>
                            {c.field}: <span className="text-slate-400 line-through">{c.from ?? "—"}</span> →{" "}
                            <span className="font-medium">{c.to ?? "—"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CatalogBanks({ banks, history }: { banks: BankRow[]; history: HistoryEntry[] }) {
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const current = selected === "new" ? null : banks.find((b) => b.id === selected) ?? null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-medium text-slate-800">Bank profiles</h2>
          <p className="text-xs text-slate-400">
            Construction loan por banco — clique para editar; cada banco cobra taxas diferentes
            (vazio = não cobra) e tudo é logado.
          </p>
        </div>
        <button
          onClick={() => setSelected("new")}
          className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#16304f]"
        >
          + New bank
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className={th}>Bank</th>
              <th className={th}>Taxa (a.a.)</th>
              <th className={th}>Base</th>
              <th className={th}>LTC / LTV</th>
              <th className={th}>Reserve</th>
              <th className={th}>Release</th>
              <th className={th}>Term</th>
              <th className={th}>Taxas custom</th>
            </tr>
          </thead>
          <tbody>
            {banks.length === 0 && (
              <tr>
                <td colSpan={8} className="px-5 py-6 text-center text-sm text-slate-400">
                  No banks yet.
                </td>
              </tr>
            )}
            {banks.map((b) => (
              <tr
                key={b.id}
                onClick={() => setSelected(b.id)}
                className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/70"
              >
                <td className={`${td} font-medium text-slate-800`}>{b.name}</td>
                <td className={td}>
                  {effectiveApr(b).toFixed(2)}%
                  {b.rateType !== "FIXED" && (
                    <span className="ml-1 text-xs text-slate-400">
                      ({b.rateType === "PRIME_SPREAD" ? "prime" : "SOFR"}+{b.spreadPct})
                    </span>
                  )}
                </td>
                <td className={td}>
                  <span className="text-xs text-slate-500">
                    {b.interestBasis === "DRAWN" ? "sacado" : "Dutch"}
                  </span>
                </td>
                <td className={td}>
                  {b.ltcBuildPct}% / {b.ltvPct}%
                </td>
                <td className={td}>
                  {b.hasInterestReserve ? (
                    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                      {b.reserveMonths}m
                    </span>
                  ) : (
                    <span className="text-xs text-slate-300">não</span>
                  )}
                </td>
                <td className={td}>
                  <span className="text-xs text-slate-500">
                    {b.releaseMode === "SWEEP_PCT_LAST_FULL" ? `${b.sweepPct}% + última quita` : "100%"}
                  </span>
                </td>
                <td className={td}>
                  {b.termMonths}m
                </td>
                <td className={td}>{b.customFees.length || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected !== null && (
        <BankModal
          bank={current}
          history={history.filter((h) => current && h.entityId === current.id)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
