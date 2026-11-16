"use client";

import { useRef, useState } from "react";
import { rowsFromItems, parseInvoicePages, linesClose, usDateToIso, type ParsedInvoice, type PdfTextItem } from "@/lib/inventory/parse-invoice";
import { isProductActivity } from "@/lib/inventory/classify";
import { submitInvoice, type SubmitInvoiceResult } from "@/lib/actions/inventory";

type Pending = { parsed: ParsedInvoice; fileName: string; file: File; kind: "GOODS" | "FREIGHT" | "SAMPLE"; result?: SubmitInvoiceResult; busy?: boolean };

const fmt = (v: number | null | undefined) => (v == null ? "—" : "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

/**
 * Solta o PDF → lê no navegador com pdf.js (por posição, cola glifos CID) → mostra o que leu →
 * envia uma invoice por vez ao servidor. Mesmo número: igual = ignorada (anexa PDF); diferente =
 * compara e pergunta antes de substituir.
 */
export function InvoiceUpload({ companyId }: { companyId: string }) {
  const [items, setItems] = useState<Pending[]>([]);
  const [reading, setReading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function readFiles(files: FileList | null) {
    if (!files?.length) return;
    setReading(true);
    setErr(null);
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = `https://unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
      const next: Pending[] = [];
      for (const file of Array.from(files)) {
        const buf = await file.arrayBuffer();
        const doc = await pdfjs.getDocument({ data: buf }).promise;
        const pages = [];
        for (let p = 1; p <= doc.numPages; p++) {
          const page = await doc.getPage(p);
          const tc = await page.getTextContent();
          pages.push(rowsFromItems(tc.items as unknown as PdfTextItem[]));
        }
        const invs = parseInvoicePages(pages);
        if (!invs.length) next.push({ parsed: { no: null, date: null, terms: null, lines: [], memo: [], container: null, subtotal: null, discount: 0, tax: 0, total: null, payment: null, balance: null, pages: doc.numPages }, fileName: file.name, file, kind: "GOODS", result: { status: "error", no: null, error: "Nenhuma invoice reconhecida neste PDF." } });
        for (const inv of invs) next.push({ parsed: inv, fileName: file.name, file, kind: inv.lines.some((l) => isProductActivity(l.activity)) ? "GOODS" : "FREIGHT" });
      }
      setItems((prev) => [...prev, ...next]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setReading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function send(idx: number, replace = false) {
    const it = items[idx];
    setItems((p) => p.map((x, i) => (i === idx ? { ...x, busy: true } : x)));
    const fd = new FormData();
    fd.set("companyId", companyId);
    fd.set("parsed", JSON.stringify(it.parsed));
    fd.set("kind", it.kind);
    fd.set("fileName", it.fileName);
    fd.set("file", it.file);
    if (replace) fd.set("replace", "1");
    const result = await submitInvoice(fd);
    setItems((p) => p.map((x, i) => (i === idx ? { ...x, busy: false, result } : x)));
  }

  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]">
          {reading ? "Lendo…" : "＋ Soltar PDF da invoice"}
          <input ref={inputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => readFiles(e.target.files)} disabled={reading} />
        </label>
        <span className="text-xs text-slate-500">Lido aqui no navegador. Um PDF pode trazer mais de uma invoice; anexos (comprovantes) são pulados. Lemos sempre o TOTAL, nunca o saldo devido.</span>
      </div>
      {err && <p className="mt-2 text-xs text-red-700">{err}</p>}
      {items.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-100">
          {items.map((it, idx) => {
            const p = it.parsed;
            const ok = linesClose(p);
            const r = it.result;
            return (
              <li key={idx} className="py-3 text-sm">
                <div className="flex flex-wrap items-center gap-3">
                  <b className="font-mono">#{p.no ?? "?"}</b>
                  <span className="text-slate-500">{usDateToIso(p.date) ?? "sem data"}</span>
                  <span className="font-semibold tabular-nums">{fmt(p.total)}</span>
                  <span className="text-xs text-slate-500">{p.lines.length} linhas · {it.fileName}{p.container ? ` · ${p.container}` : ""}</span>
                  {!ok && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase text-amber-700">linhas ≠ total</span>}
                  {!r && (
                    <>
                      <select value={it.kind} onChange={(e) => setItems((pp) => pp.map((x, i) => (i === idx ? { ...x, kind: e.target.value as Pending["kind"] } : x)))} className="rounded border border-slate-300 px-2 py-1 text-xs">
                        <option value="GOODS">Mercadoria</option>
                        <option value="FREIGHT">Frete</option>
                        <option value="SAMPLE">Sample</option>
                      </select>
                      <button onClick={() => send(idx)} disabled={it.busy || !p.no} className="rounded-lg border border-[#1f3a5f] px-3 py-1 text-xs font-semibold text-[#1f3a5f] hover:bg-slate-50 disabled:opacity-50">
                        {it.busy ? "…" : "Lançar"}
                      </button>
                    </>
                  )}
                  {r?.status === "created" && <span className="text-xs font-semibold text-emerald-700">✓ lançada</span>}
                  {r?.status === "replaced" && <span className="text-xs font-semibold text-emerald-700">✓ substituída (anterior no histórico)</span>}
                  {r?.status === "same" && <span className="text-xs text-slate-600">já estava lançada com o mesmo total · {r.attachedPdf ? "PDF anexado" : "nada mudou"}</span>}
                  {r?.status === "error" && <span className="text-xs text-red-700">{r.error}</span>}
                </div>
                {r?.status === "differs" && (
                  <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                    <b>Invoice #{r.no} já existe com total diferente.</b> Provável correção.
                    <div className="mt-1 grid grid-cols-2 gap-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-amber-700">Lançada</div>
                        {r.existing.date} · {fmt(r.existing.total)} · {r.existing.lines} linhas · {r.existing.fileName ?? "sem PDF"}
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-amber-700">Nova</div>
                        {r.incoming.date ?? "—"} · {fmt(r.incoming.total)} · {r.incoming.lines} linhas · {it.fileName}
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <button onClick={() => send(idx, true)} disabled={it.busy} className="rounded-lg bg-amber-700 px-3 py-1 font-semibold text-white">Substituir pela nova</button>
                      <button onClick={() => setItems((pp) => pp.filter((_, i) => i !== idx))} className="rounded-lg border border-amber-300 px-3 py-1">Manter a lançada</button>
                    </div>
                  </div>
                )}
                {!r && p.lines.length > 0 && (
                  <details className="mt-1 text-xs text-slate-600">
                    <summary className="cursor-pointer">ver linhas lidas</summary>
                    <table className="mt-1 w-full">
                      <tbody>
                        {p.lines.map((l, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="py-0.5 pr-2">{l.activity}{l.desc.length ? <span className="block text-[10px] text-slate-400">{l.desc.join(" · ").slice(0, 120)}</span> : null}</td>
                            <td className="py-0.5 text-right tabular-nums">{l.qty ?? "—"}</td>
                            <td className="py-0.5 text-right tabular-nums">{l.rate != null ? fmt(l.rate) : "—"}</td>
                            <td className="py-0.5 text-right tabular-nums">{fmt(l.amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {p.memo.length > 0 && <p className="mt-1 text-[10px] text-slate-400">memo: {p.memo.join(" | ").slice(0, 300)}</p>}
                  </details>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
