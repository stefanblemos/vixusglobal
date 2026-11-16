import Link from "next/link";
import { prisma } from "@/lib/db";
import { inventoryContext } from "../_lib";
import { InventoryShell, br, card, h2, money, pct1, pill } from "@/components/inventory/inventory-shell";
import { ActionForm } from "@/components/inventory/action-form";
import { buildShipmentView, loadInvoices, recomputeShipments } from "@/lib/inventory/shipments";
import { closeShipmentCosts } from "@/lib/actions/inventory";
import { ShipmentNotes } from "@/components/inventory/shipment-notes";
import { notesHash, toNotesInvoices } from "@/lib/inventory/claude-notes";

export const dynamic = "force-dynamic";

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ company?: string; f?: string }> }) {
  const { company, f } = await searchParams;
  const ctx = await inventoryContext(company);
  const cid = ctx.companyId;
  if (cid) await recomputeShipments(cid);
  const [ships, all] = cid
    ? await Promise.all([prisma.inventoryShipment.findMany({ where: { companyId: cid }, orderBy: [{ deliveredAt: "desc" }] }), loadInvoices(cid)])
    : [[], []];
  const terms = ctx.settings?.closeHintTerms ?? [];
  const billNums = new Set((ctx.gl?.vendorBills ?? []).map((b) => b.num));
  const q = `?company=${cid}`;
  const rows = ships.map((s) => ({ s, v: s.isOpening ? null : buildShipmentView(all, s.id, terms) }));
  const shown = rows.filter(({ s }) => (f === "closed" ? !!s.closedAt : f === "all" ? true : !s.closedAt));
  const samplesWaiting = all.filter((i) => i.kind === "SAMPLE" && !i.shipmentId);

  return (
    <InventoryShell tab="shipments" companies={ctx.companies} companyId={cid} companyName={ctx.company?.legalName ?? null} glUntil={ctx.gl?.coverageUntil ?? null}>
      <div className="flex gap-1 text-xs">
        {([["", "Custos em aberto"], ["closed", "Fechados"], ["all", "Todos"]] as const).map(([k, l]) => (
          <Link key={k} href={`/inventory/shipments${q}${k ? `&f=${k}` : ""}`} className={`rounded-full border px-2.5 py-0.5 ${(f ?? "") === k ? "border-[#1f3a5f] bg-[#1f3a5f] text-white" : "border-slate-200 text-slate-500"}`}>{l}</Link>
        ))}
      </div>
      {shown.length === 0 && <p className="text-sm text-slate-500">Nenhum embarque aqui. O embarque nasce quando entra a invoice de frete (container + consolidação).</p>}
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map(({ s, v }) => {
          const name = s.name ?? (s.containers.length ? s.containers.join(" + ") : s.key);
          const d = s.closedData as { merch: number; pool: number; absorption: number; items: unknown[] } | null;
          const merch = s.closedAt && d ? d.merch : v?.merch ?? 0;
          const pool = s.closedAt && d ? d.pool : v?.pool ?? 0;
          const abs = s.closedAt && d ? d.absorption : v?.absorption ?? 0;
          const notInGl = v ? [...v.goods, ...v.freights].filter((i) => !billNums.has(i.no)) : [];
          return (
            <div key={s.id} className={`${card} ${!s.closedAt && v?.closeHint ? "border-[#1f3a5f] shadow-[0_0_0_3px_#e8eef7]" : ""}`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <Link href={`/inventory/shipments/${s.id}${q}`} className="font-semibold text-slate-900 hover:underline">{name}</Link>
                  {s.name && s.containers.length > 0 && <span className="ml-2 font-mono text-xs text-slate-500">{s.containers.join(" + ")}</span>}
                  <div className="text-[11px] text-slate-500">
                    {s.isOpening ? `camada de abertura · ${br(s.deliveredAt)}` : <>{s.containers.length} container(s) · {v?.freights.length ?? 0} invoice(s) de frete · <b>entrega {br(s.deliveredAt)}</b> (data da última invoice de frete)</>}
                  </div>
                </div>
                {s.isOpening ? pill("off", "abertura") : s.closedAt ? pill("ok", "custos fechados") : v?.missingRefs.length ? pill("bad", "falta invoice citada") : v?.closeHint ? pill("info", "sugerido fechar custos") : pill("warn", "custos em aberto")}
              </div>
              <dl className="mt-3 grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
                <dt className="text-slate-500">Mercadoria{v ? ` · ${v.goods.length} invoice(s)` : ""}</dt><dd className="text-right tabular-nums">{money(merch)}</dd>
                <dt className="text-slate-500">Frete e importação{v ? ` · ${v.costs.length} linha(s)` : ""}</dt><dd className="text-right tabular-nums">{money(pool)}</dd>
                <dt className="text-slate-500">Custo desembarcado</dt><dd className="text-right font-bold tabular-nums text-[#1f3a5f]">{money(merch + pool)}</dd>
                <dt className="text-slate-500">Absorção</dt><dd className="text-right tabular-nums">{pct1(abs)}</dd>
              </dl>
              {v && v.missingRefs.length > 0 && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">Faltam as invoices citadas na consolidação: {v.missingRefs.join(", ")}. Sem elas o custo dos outros produtos sobe.</div>}
              {v && v.missingRefs.length === 0 && v.goods.length > 0 && !s.closedAt && <div className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">✓ Todas as invoices citadas estão aqui.</div>}
              {v && !s.closedAt && v.closeHint && <div className="mt-2 rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-700">A invoice de frete traz <b>{v.closeHint}</b>: costuma ser o último custo do embarque. Sugerimos fechar.</div>}
              {v && !s.closedAt && !v.closeHint && v.freights.length > 0 && !s.aiNote && <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">Sem sinal de entrega final na invoice de frete (cross-docking e entrega costumam vir à parte). Pode fechar mesmo assim.</div>}
              {v && !s.isOpening && (s.aiNote || !s.closedAt) && <ShipmentNotes sh={s} hash={notesHash(toNotesInvoices(all.filter((i) => i.shipmentId === s.id)))} closed={!!s.closedAt} />}
              {notInGl.length > 0 && ctx.gl?.coverageUntil && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">GL: {notInGl.filter((i) => i.date.getTime() <= ctx.gl!.coverageUntil!.getTime()).length ? `faltam no QBO: ${notInGl.filter((i) => i.date.getTime() <= ctx.gl!.coverageUntil!.getTime()).map((i) => "#" + i.no).join(", ")}` : "invoices posteriores à cobertura do GL"}.</div>}
              {v && v.lateFreight.length > 0 && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">Frete após o fechamento: {v.lateFreight.map((i) => `#${i.no} ${money(i.total)}`).join(", ")} → COGS do mês em que entrou (a camada não muda).</div>}
              {!s.isOpening && !s.closedAt && v && v.goods.length > 0 && (
                <div className="mt-3">
                  <ActionForm action={closeShipmentCosts} submitLabel="Fechar custos" className="flex flex-wrap items-center gap-3" confirm={`Fechar os custos de ${name}? A camada entra no estoque em ${br(s.deliveredAt)} com absorção ${pct1(abs)} e não muda mais.`}>
                    <input type="hidden" name="shipmentId" value={s.id} />
                    <label className="flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" name="force" value="1" /> fechar mesmo assim (invoice citada não vem / item sem par)</label>
                  </ActionForm>
                </div>
              )}
            </div>
          );
        })}
      </div>
      {samplesWaiting.length > 0 && (
        <details className="rounded-xl border border-dashed border-slate-200 px-4 py-2 text-xs text-slate-500">
          <summary className="cursor-pointer">
            {samplesWaiting.length} sample(s) sem lote · {money(samplesWaiting.reduce((x, s) => x + Number(s.total), 0))} — chegam por avião, fora dos embarques; só entram no custo se a compra do lote acontecer
          </summary>
          <ul className="mt-2">
            {samplesWaiting.map((s) => <li key={s.id} className="border-t border-slate-100 py-1 first:border-0"><b className="font-mono text-slate-700">#{s.no}</b> · {money(s.total)} · {br(s.date)}</li>)}
          </ul>
          <p className="mt-2 text-[11px]">Em <Link href={`/inventory/invoices${q}&f=sample`} className="text-[#1f3a5f] hover:underline">Invoices › Sample</Link>: se o lote vier, aponte o item e o embarque (o custo dilui no lote); se não vier, dê baixa do sample.</p>
        </details>
      )}
    </InventoryShell>
  );
}
