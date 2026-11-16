import Link from "next/link";
import { prisma } from "@/lib/db";
import { inventoryContext } from "../_lib";
import { waitDaysFor } from "@/lib/inventory/settings";
import { InventoryShell, Kpi, br, card, h2, money, pill, td, tdr, th, thr } from "@/components/inventory/inventory-shell";
import { InvoiceUpload } from "@/components/inventory/invoice-upload";
import { InvoiceManualForm } from "@/components/inventory/invoice-manual-form";
import { ActionForm } from "@/components/inventory/action-form";
import { createInvoiceFromGl, deleteInvoice, pinInvoice, setInvoiceKind } from "@/lib/actions/inventory";

export const dynamic = "force-dynamic";

const KIND = { GOODS: "Mercadoria", FREIGHT: "Frete", SAMPLE: "Sample" } as const;

export default async function InvoicesPage({ searchParams }: { searchParams: Promise<{ company?: string; f?: string }> }) {
  const { company, f } = await searchParams;
  const ctx = await inventoryContext(company);
  const cid = ctx.companyId;
  const [invoices, shipments] = cid
    ? await Promise.all([
        prisma.inventoryInvoice.findMany({ where: { companyId: cid }, include: { lines: { select: { activity: true, qty: true, isProduct: true } }, shipment: { select: { id: true, name: true, containers: true, key: true, closedAt: true } } }, orderBy: [{ date: "desc" }, { no: "desc" }] }),
        prisma.inventoryShipment.findMany({ where: { companyId: cid, isOpening: false }, select: { id: true, name: true, containers: true, key: true }, orderBy: { createdAt: "desc" } }),
      ])
    : [[], []];
  const gl = ctx.gl;
  const billNums = new Set((gl?.vendorBills ?? []).map((b) => b.num).filter(Boolean) as string[]);
  const invNos = new Set(invoices.map((i) => i.no));
  const onlyInQbo = [...billNums].filter((n) => !invNos.has(n)).map((n) => {
    const rows = (gl?.vendorBills ?? []).filter((b) => b.num === n);
    return { num: n, date: rows[0].date, total: rows.reduce((s, r) => s + r.amount, 0), accounts: [...new Set(rows.map((r) => r.account))].join(", ") };
  });
  const coverage = gl?.coverageUntil ?? null;
  const onlyHere = invoices.filter((i) => coverage && i.date.getTime() <= coverage.getTime() && !billNums.has(i.no));
  const noShipment = invoices.filter((i) => i.kind === "GOODS" && !i.shipmentId);
  const waitOf = (v: string) => (ctx.settings ? waitDaysFor(ctx.settings, v) : 30);
  const waitDays = waitOf(ctx.settings?.vendorName ?? "");
  const vendors = ctx.settings?.vendors.map((v) => v.name) ?? [];
  const days = (d: Date) => Math.round((Date.now() - d.getTime()) / 86400000);
  const shipLabel = (s: { name: string | null; containers: string[]; key: string } | null | undefined) => (s ? s.name ?? (s.containers.length ? s.containers.join(" + ") : s.key) : "—");
  const filtered = invoices.filter((i) => (f === "nos" ? !i.shipmentId && i.kind !== "SAMPLE" : f === "goods" ? i.kind === "GOODS" : f === "freight" ? i.kind === "FREIGHT" : f === "sample" ? i.kind === "SAMPLE" : true));
  const q = `?company=${cid}`;

  return (
    <InventoryShell tab="invoices" companies={ctx.companies} companyId={cid} companyName={ctx.company?.legalName ?? null} glUntil={coverage}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi k="Invoices" v={invoices.length} h={`${invoices.filter((i) => i.pdfSize).length} com PDF`} />
        <Kpi k="Sem embarque" v={noShipment.length} h={noShipment.length ? `${noShipment.filter((i) => days(i.date) > waitDays).length} há mais de ${waitDays} dias` : "nenhuma na fila"} />
        <Kpi k="Só no QBO" v={onlyInQbo.length} h="bills do fornecedor sem invoice aqui" />
        <Kpi k="Só aqui" v={onlyHere.length} h="invoices que o GL não tem (até a cobertura)" />
        <Kpi k="Aguardando GL" v={invoices.filter((i) => !coverage || i.date.getTime() > coverage.getTime()).length} h={coverage ? `posteriores a ${br(coverage)}` : "GL não carregado"} />
      </div>

      {cid && (
        <div className="flex flex-wrap items-start gap-3">
          <div className="flex-1 min-w-[320px]"><InvoiceUpload companyId={cid} vendors={vendors} /></div>
          <InvoiceManualForm companyId={cid} vendors={vendors} />
        </div>
      )}

      {onlyInQbo.length > 0 && cid && (
        <div className={card}>
          <h2 className={h2}>Só no QBO · bills do fornecedor sem invoice aqui</h2>
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Bill</th><th className={th}>Data</th><th className={thr}>Total</th><th className={th}>Contas</th><th className={th}></th></tr></thead>
            <tbody>
              {onlyInQbo.map((b) => (
                <tr key={b.num} className="border-t border-slate-100">
                  <td className={`${td} font-mono`}>#{b.num}</td><td className={td}>{br(b.date)}</td><td className={tdr}>{money(b.total)}</td><td className={`${td} text-xs text-slate-500`}>{b.accounts}</td>
                  <td className={td}>
                    <ActionForm action={createInvoiceFromGl} submitLabel="criar a partir do GL" submitClass="rounded-lg border border-[#1f3a5f] px-2 py-1 text-[11px] font-semibold text-[#1f3a5f] hover:bg-slate-50" className="flex items-center gap-2">
                      <input type="hidden" name="companyId" value={cid} /><input type="hidden" name="num" value={b.num} />
                    </ActionForm>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-400">Entra com as linhas do GL (sem quantidade e sem PDF). Depois solte o PDF: mesmo número e mesmo total só anexa o arquivo.</p>
        </div>
      )}

      <div className={card}>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className={`${h2} mb-0`}>Invoices</h2>
          <div className="flex gap-1 text-xs">
            {([["", "Todas"], ["nos", "Sem embarque"], ["goods", "Mercadoria"], ["freight", "Frete"], ["sample", "Sample"]] as const).map(([k, l]) => (
              <Link key={k} href={`/inventory/invoices${q}${k ? `&f=${k}` : ""}`} className={`rounded-full border px-2.5 py-0.5 ${(f ?? "") === k ? "border-[#1f3a5f] bg-[#1f3a5f] text-white" : "border-slate-200 text-slate-500"}`}>{l}</Link>
            ))}
          </div>
        </div>
        {filtered.length === 0 ? (
          <p className="text-sm text-slate-500">Nenhuma invoice. Solte o PDF acima ou crie a partir das bills do GL.</p>
        ) : (
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Invoice</th><th className={th}>Data</th><th className={th}>Tipo</th><th className={thr}>Total</th><th className={th}>Embarque</th><th className={th}>Origem · GL</th><th className={th}>Situação</th><th className={th}></th></tr></thead>
            <tbody>
              {filtered.map((i) => {
                const prods = i.lines.filter((l) => l.isProduct);
                const qty = prods.reduce((s, l) => s + Number(l.qty ?? 0), 0);
                const desc = i.kind === "FREIGHT" ? `${i.lines.slice(0, 3).map((l) => l.activity.split(":").pop()).join(", ")}${i.containers.length ? " · " + i.containers.join(" / ") : ""}` : `${prods.slice(0, 2).map((l) => l.activity.replace(/^products?:\s*/i, "")).join(", ")}${prods.length > 2 ? ` +${prods.length - 2}` : ""}${qty ? ` · ${qty.toLocaleString("en-US")} pç` : ""}`;
                const inGl = billNums.has(i.no);
                const status = i.kind === "SAMPLE" ? (i.sampleWrittenOffAt ? pill("off", "baixado") : i.shipmentId ? pill("ok", "diluído") : pill("off", "aguarda o lote")) : i.shipmentId ? (i.shipment?.closedAt ? pill("ok", i.lateAdjustment ? "ajuste tardio" : "custo fechado") : pill("info", "no embarque")) : i.kind === "GOODS" ? pill(days(i.date) > waitOf(i.vendorName) ? "warn" : "off", `${days(i.date)} dias sem frete`) : pill("warn", "frete sem embarque");
                return (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className={td}><b className="font-mono">#{i.no}</b><span className="block text-[11px] text-slate-500">{desc}</span></td>
                    <td className={`${td} whitespace-nowrap`}>{br(i.date)}</td>
                    <td className={td}>
                      <form action={setInvoiceKind}>
                        <input type="hidden" name="invoiceId" value={i.id} />
                        <select name="kind" defaultValue={i.kind} className="rounded border border-slate-200 px-1 py-0.5 text-xs" disabled={!!i.shipment?.closedAt && !i.lateAdjustment}>
                          {Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>{" "}
                        <button className="text-[10px] text-slate-400 hover:text-[#1f3a5f]">ok</button>
                      </form>
                    </td>
                    <td className={tdr}>{money(Number(i.total))}{!i.linesOk && <span className="block text-[10px] text-amber-700">linhas ≠ total</span>}</td>
                    <td className={td}>
                      {i.shipment ? <Link href={`/inventory/shipments/${i.shipment.id}${q}`} className="text-[#1f3a5f] hover:underline">{shipLabel(i.shipment)}</Link> : i.kind === "GOODS" && shipments.length ? (
                        <form action={pinInvoice} className="flex items-center gap-1">
                          <input type="hidden" name="invoiceId" value={i.id} />
                          <select name="shipmentId" className="rounded border border-slate-200 px-1 py-0.5 text-xs"><option value="">apontar…</option>{shipments.map((s) => <option key={s.id} value={s.id}>{shipLabel(s)}</option>)}</select>
                          <button className="text-[10px] text-slate-400 hover:text-[#1f3a5f]">ok</button>
                        </form>
                      ) : "—"}
                    </td>
                    <td className={`${td} text-[11px] text-slate-500`}>{i.source === "GL" ? "GL (sem PDF)" : i.pdfSize ? "PDF" : "digitada"}{inGl ? " · no QBO" : coverage && i.date.getTime() <= coverage.getTime() ? " · falta no QBO" : " · aguarda GL"}</td>
                    <td className={td}>{status}</td>
                    <td className={td}>
                      {!(i.shipment?.closedAt && !i.lateAdjustment) && (
                        <form action={deleteInvoice}><input type="hidden" name="invoiceId" value={i.id} /><button className="text-[11px] text-slate-400 hover:text-red-600">apagar</button></form>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </InventoryShell>
  );
}
