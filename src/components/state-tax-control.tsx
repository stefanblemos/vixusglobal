"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import type { StateTaxControl } from "@/lib/tax/state-tax";
import { saveStateTaxFiling, deleteStateTaxFiling, readStateTaxReceipt } from "@/lib/actions/state-tax";

type Prefill = {
  companyId: string;
  jurisdiction: string;
  taxYear: string;
  principal: string;
  penalty: string;
  interest: string;
  paidDate: string;
  source: string;
  fromReceipt: boolean;
};
const blankPrefill = (): Prefill => ({
  companyId: "", jurisdiction: "FL", taxYear: "", principal: "", penalty: "", interest: "", paidDate: "", source: "", fromReceipt: false,
});

const money = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(Math.round(n));
const money2 = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 }).format(n);

const inputCls =
  "rounded-lg border border-slate-300 px-2 py-1 text-sm focus:border-sky-400 focus:outline-none";

export function StateTaxControl({ data }: { data: StateTaxControl }) {
  const [open, setOpen] = useState(false);
  const [prefill, setPrefill] = useState<Prefill>(blankPrefill);
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const { companies, companyOptions, totals } = data;

  const openManual = () => {
    setPrefill(blankPrefill());
    setReadError(null);
    setOpen(true);
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // permite reescolher o mesmo arquivo
    if (!file) return;
    setReading(true);
    setReadError(null);
    try {
      const fd = new FormData();
      fd.set("file", file);
      const res = await readStateTaxReceipt(fd);
      if (!res.ok) {
        setReadError(res.error);
        return;
      }
      const d = res.data;
      const numStr = (n: number | null | undefined) => (n != null ? String(n) : "");
      setPrefill({
        companyId: res.companyId ?? "",
        jurisdiction: (d.jurisdiction || "FL").toUpperCase(),
        taxYear: d.taxYear != null ? String(d.taxYear) : "",
        principal: numStr(d.principal),
        penalty: numStr(d.penalty),
        interest: numStr(d.interest),
        paidDate: d.paidDate || "",
        source: d.source || "Recibo (PDF)",
        fromReceipt: true,
      });
      setOpen(true);
    } catch (err) {
      setReadError(err instanceof Error ? err.message : "Falha ao ler o recibo.");
    } finally {
      setReading(false);
    }
  };

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
        <div className="flex shrink-0 items-center gap-2">
          <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onPickFile} />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={reading}
            className="rounded-lg border border-[#1f3a5f] px-3 py-1.5 text-sm font-medium text-[#1f3a5f] hover:bg-slate-50 disabled:opacity-50"
          >
            {reading ? "Lendo recibo…" : "Ler recibo (PDF)"}
          </button>
          <button
            onClick={openManual}
            className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#16304f]"
          >
            Adicionar apuração
          </button>
        </div>
      </div>
      {readError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{readError}</div>
      )}

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
            {prefill.fromReceipt && (
              <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                Pré-preenchido do recibo — confira os valores antes de salvar.
                {!prefill.companyId && " Não consegui casar a empresa automaticamente; selecione abaixo."}
              </div>
            )}
            <form key={prefill.source + prefill.taxYear} action={saveStateTaxFiling} onSubmit={() => setTimeout(() => setOpen(false), 50)} className="grid grid-cols-2 gap-3">
              <label className="col-span-2 flex flex-col gap-1 text-xs text-slate-600">
                Empresa
                <select name="companyId" required defaultValue={prefill.companyId} className={inputCls}>
                  <option value="">Selecione…</option>
                  {companyOptions.map((c) => (
                    <option key={c.id} value={c.id}>{c.legalName}</option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Estado
                <input name="jurisdiction" defaultValue={prefill.jurisdiction} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Ano de competência
                <input name="taxYear" type="number" placeholder="2024" required defaultValue={prefill.taxYear} className={inputCls} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Principal (imposto)
                <input name="principal" inputMode="decimal" placeholder="21765.00" required defaultValue={prefill.principal} className={`${inputCls} text-right tabular-nums`} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Multa
                <input name="penalty" inputMode="decimal" placeholder="7679.05" defaultValue={prefill.penalty} className={`${inputCls} text-right tabular-nums`} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Juros
                <input name="interest" inputMode="decimal" placeholder="1791.78" defaultValue={prefill.interest} className={`${inputCls} text-right tabular-nums`} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-slate-600">
                Pago em
                <input name="paidDate" type="date" defaultValue={prefill.paidDate} className={inputCls} />
              </label>
              <label className="col-span-2 flex flex-col gap-1 text-xs text-slate-600">
                Origem (opcional)
                <input name="source" placeholder="F-1120 notice / recibo" defaultValue={prefill.source} className={inputCls} />
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
