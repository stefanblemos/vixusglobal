"use client";

import { useState } from "react";
import { ActionForm } from "./action-form";
import { createInvoiceManual } from "@/lib/actions/inventory";

type L = { activity: string; desc: string; qty: string; rate: string; amount: string };
const input = "rounded-lg border border-slate-300 px-2 py-1 text-xs outline-none focus:border-[#8DC63F]";

/** Invoice sem PDF: cabeçalho + linhas. Linha de produto começa com "Products:". */
export function InvoiceManualForm({ companyId, vendors }: { companyId: string; vendors: string[] }) {
  const [open, setOpen] = useState(false);
  const [lines, setLines] = useState<L[]>([{ activity: "Products:", desc: "", qty: "", rate: "", amount: "" }]);
  const upd = (i: number, k: keyof L, v: string) =>
    setLines((ls) =>
      ls.map((l, j) => {
        if (j !== i) return l;
        const n = { ...l, [k]: v };
        const q = Number(n.qty), r = Number(n.rate);
        if ((k === "qty" || k === "rate") && q && r) n.amount = (q * r).toFixed(2);
        return n;
      }),
    );
  if (!open)
    return (
      <button onClick={() => setOpen(true)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100">
        ＋ Lançar sem PDF
      </button>
    );
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Invoice sem PDF</h3>
        <button onClick={() => setOpen(false)} className="text-xs text-slate-500 hover:underline">fechar</button>
      </div>
      <ActionForm action={createInvoiceManual} submitLabel="Lançar invoice">
        <input type="hidden" name="companyId" value={companyId} />
        <input type="hidden" name="lines" value={JSON.stringify(lines.filter((l) => l.activity && l.amount).map((l) => ({ activity: l.activity, desc: l.desc, qty: l.qty === "" ? null : Number(l.qty), rate: l.rate === "" ? null : Number(l.rate), amount: Number(l.amount) })))} />
        <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
          {vendors.length > 1 ? <select name="vendor" className={input}>{vendors.map((v) => <option key={v} value={v}>{v}</option>)}</select> : <input type="hidden" name="vendor" value={vendors[0] ?? ""} />}
          <input name="no" placeholder="Nº invoice *" required className={input} />
          <input name="date" type="date" required className={input} />
          <select name="kind" className={input}>
            <option value="GOODS">Mercadoria</option>
            <option value="FREIGHT">Frete</option>
            <option value="SAMPLE">Sample</option>
          </select>
          <input name="container" placeholder="Container(s)" className={input} />
          <input name="discount" placeholder="Desconto" className={input} />
          <input name="tax" placeholder="Tax" className={input} />
        </div>
        <textarea name="memo" placeholder="Memo / Consolidation: Invoice 26051 disk light | Invoice 26072 …" rows={2} className={`${input} w-full`} />
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wider text-slate-400">
              <th className="py-1">Activity (Products:… ou custo)</th><th>Descrição</th><th className="text-right">Qtd</th><th className="text-right">Rate</th><th className="text-right">Amount</th><th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l, i) => (
              <tr key={i}>
                <td className="py-0.5 pr-1"><input value={l.activity} onChange={(e) => upd(i, "activity", e.target.value)} className={`${input} w-full`} /></td>
                <td className="py-0.5 pr-1"><input value={l.desc} onChange={(e) => upd(i, "desc", e.target.value)} className={`${input} w-full`} /></td>
                <td className="py-0.5 pr-1"><input value={l.qty} onChange={(e) => upd(i, "qty", e.target.value)} className={`${input} w-20 text-right`} /></td>
                <td className="py-0.5 pr-1"><input value={l.rate} onChange={(e) => upd(i, "rate", e.target.value)} className={`${input} w-24 text-right`} /></td>
                <td className="py-0.5 pr-1"><input value={l.amount} onChange={(e) => upd(i, "amount", e.target.value)} className={`${input} w-28 text-right`} /></td>
                <td><button type="button" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-600">×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <button type="button" onClick={() => setLines((ls) => [...ls, { activity: "", desc: "", qty: "", rate: "", amount: "" }])} className="text-xs text-[#1f3a5f] hover:underline">＋ linha</button>
      </ActionForm>
    </div>
  );
}
