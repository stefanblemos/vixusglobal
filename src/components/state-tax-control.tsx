"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { StateTaxControl } from "@/lib/tax/state-tax";
import { saveStateTaxFiling, deleteStateTaxFiling } from "@/lib/actions/state-tax";

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.round(n));
const money2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

const inputCls =
  "rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-sky-400 focus:outline-none";

export function StateTaxControl({ data }: { data: StateTaxControl }) {
  const [open, setOpen] = useState(false);
  const { companies, companyOptions, totals } = data;

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium text-slate-800">
            Controle do imposto estadual (F-1120) — apurado &amp; pago
          </h2>
          <p className="text-sm text-slate-500">
            O que de fato foi apurado e pago por ano, separando principal · multa · juros. É a fonte
            que explica o add-back de “State income tax” no Schedule M-1 do ano seguinte.
          </p>
        </div>
        <button
          onClick={() => setOpen(true)}
          className="shrink-0 rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#16304f]"
        >
          Adicionar apuração
        </button>
      </div>

      {companies.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Nenhuma apuração estadual registrada. Clique em “Adicionar apuração” e lance, por ano de
          competência, o principal, a multa e os juros (do recibo/notice do F-1120).
        </div>
      ) : (
        <div className="space-y-4">
          {companies.map((c) => (
            <div key={c.companyId} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="flex items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
                {c.name}
                {c.state && <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600">{c.state}</span>}
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-[11px] text-slate-400">
                  <tr>
                    <th className="px-4 py-1.5 font-medium">Competência</th>
                    <th className="px-3 py-1.5 text-right font-medium">Principal</th>
                    <th className="px-3 py-1.5 text-right font-medium">Multa</th>
                    <th className="px-3 py-1.5 text-right font-medium">Juros</th>
                    <th className="px-3 py-1.5 text-right font-medium">Total pago</th>
                    <th className="px-3 py-1.5 text-center font-medium">Pago em</th>
                    <th className="px-3 py-1.5 text-right font-medium">Add-back M-1</th>
                    <th className="px-2 py-1.5"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {c.filings.map((f) => (
                    <tr key={f.id} className="align-top hover:bg-slate-50/60">
                      <td className="px-4 py-2 font-medium text-slate-700">
                        {f.jurisdiction} {f.taxYear}
                        {f.source && <div className="text-[10px] font-normal text-slate-400">{f.source}</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-700">{money2(f.principal)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-amber-700">{f.penalty ? money2(f.penalty) : "—"}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">{f.interest ? money2(f.interest) : "—"}</td>
                      <td className="px-3 py-2 text-right font-semibold tabular-nums text-slate-900">{money2(f.total)}</td>
                      <td className="px-3 py-2 text-center text-xs text-slate-500">{f.paidDate ?? "—"}</td>
                      <td className="px-3 py-2 text-right">
                        {f.paidYear ? (
                          <div>
                            <div className="font-semibold tabular-nums text-slate-900">{money2(f.addBack)}</div>
                            <div className="text-[10px] text-slate-400">no M-1 de {f.paidYear}</div>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">sem data</span>
                        )}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <form action={deleteStateTaxFiling}>
                          <input type="hidden" name="id" value={f.id} />
                          <button className="text-xs text-slate-300 hover:text-red-600" title="Remover">✕</button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Explicação do add-back por ano pago */}
              <div className="space-y-1 border-t border-slate-100 bg-slate-50/40 px-4 py-2 text-[11px] text-slate-500">
                {c.filings
                  .filter((f) => f.paidYear)
                  .map((f) => (
                    <div key={f.id}>
                      <span className="font-medium text-slate-600">Add-back M-1 de {f.paidYear}:</span>{" "}
                      {money2(f.addBack)} = principal {money2(f.principal)} (deduzido em {f.taxYear})
                      {f.penalty > 0 && <> + multa {money2(f.penalty)} (não dedutível)</>}.
                      {f.interest > 0 && (
                        <span className="text-sky-700">
                          {" "}
                          Juros {money2(f.interest)} são dedutíveis p/ C-corp — se também foram
                          adicionados de volta, há ~{money(f.interestDeductible * 0.21)} a recuperar.
                        </span>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ))}
          <div className="flex flex-wrap gap-4 rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-2 text-xs text-slate-600">
            <span>Principal total: <span className="font-semibold tabular-nums">{money2(totals.principal)}</span></span>
            <span>Multas: <span className="font-semibold tabular-nums text-amber-700">{money2(totals.penalty)}</span></span>
            <span>Juros: <span className="font-semibold tabular-nums">{money2(totals.interest)}</span></span>
            <span>Total pago: <span className="font-semibold tabular-nums">{money2(totals.total)}</span></span>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-400">
        Tratamento: principal é dedutível no federal no ano de competência (§164); multa não é
        dedutível (§162(f)); juros sobre imposto são dedutíveis para C-corp (§163, sujeito a 163(j)).
        O add-back de “State income tax” do ano do pagamento = principal + multa.
      </p>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center"
          onClick={() => setOpen(false)}
        >
          <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-medium text-slate-800">Apuração estadual (F-1120)</h3>
              <button onClick={() => setOpen(false)} className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100">✕</button>
            </div>
            <form action={saveStateTaxFiling} onSubmit={() => setTimeout(() => setOpen(false), 50)} className="grid grid-cols-2 gap-3">
              <label className="col-span-2 flex flex-col gap-1 text-xs text-slate-600">
                Empresa
                <select name="companyId" required className={inputCls}>
                  <option value="">Selecione…</option>
                  {companyOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.legalName}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Estado
                <input name="jurisdiction" defaultValue="FL" className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Ano de competência
                <input name="taxYear" type="number" placeholder="2024" required className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Principal (imposto)
                <input name="principal" inputMode="decimal" placeholder="21765.00" required className={`${inputCls} text-right tabular-nums`} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Multa
                <input name="penalty" inputMode="decimal" placeholder="7679.05" className={`${inputCls} text-right tabular-nums`} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Juros
                <input name="interest" inputMode="decimal" placeholder="1791.78" className={`${inputCls} text-right tabular-nums`} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Pago em
                <input name="paidDate" type="date" className={inputCls} />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs text-slate-600">
                Origem (opcional)
                <input name="source" placeholder="F-1120 notice / recibo" className={inputCls} />
              </label>
              <div className="col-span-2 flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-sm text-slate-500 hover:bg-slate-100">Cancelar</button>
                <SaveButton />
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      className="rounded-lg bg-[#1f3a5f] px-4 py-1.5 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
    >
      {pending ? "Salvando…" : "Salvar"}
    </button>
  );
}
