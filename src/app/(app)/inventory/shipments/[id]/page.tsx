import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { InventoryShell, br, card, h2, money, pct1, pill, td, tdr, th, thr } from "@/components/inventory/inventory-shell";
import { ActionForm } from "@/components/inventory/action-form";
import { buildShipmentView, loadInvoices, type ClosedData } from "@/lib/inventory/shipments";
import { getInventorySettings, marginOf, priceForMargin, resolveInventoryCompany } from "@/lib/inventory/settings";
import { loadGlData } from "@/lib/inventory/gl";
import { COST_GROUP_LABEL, type CostGroup } from "@/lib/inventory/classify";
import { closeShipmentCosts, renameShipment, reopenShipment } from "@/lib/actions/inventory";
import { ShipmentNotes } from "@/components/inventory/shipment-notes";
import { notesHash, toNotesInvoices } from "@/lib/inventory/claude-notes";

export const dynamic = "force-dynamic";

export default async function ShipmentDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ company?: string }> }) {
  const { id } = await params;
  const { company } = await searchParams;
  const sh = await prisma.inventoryShipment.findUnique({ where: { id } });
  if (!sh) notFound();
  const ctx = await resolveInventoryCompany(company ?? sh.companyId);
  const settings = await getInventorySettings(sh.companyId);
  const [all, gl, items] = await Promise.all([loadInvoices(sh.companyId), loadGlData(sh.companyId, settings), prisma.inventoryItem.findMany({ where: { companyId: sh.companyId }, select: { id: true, name: true, listPrice: true, currentCost: true } })]);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const v = sh.isOpening ? null : buildShipmentView(all, sh.id, settings.closeHintTerms);
  const d = sh.closedData as unknown as ClosedData | null;
  const name = sh.name ?? (sh.containers.length ? sh.containers.join(" + ") : sh.key);
  const margin = Number(settings.marginPct);
  const q = `?company=${sh.companyId}`;
  const frozen = !!sh.closedAt && !!d;
  const rows = frozen
    ? d!.items.map((i) => ({ name: i.name, itemId: i.itemId, invNo: i.invNo, qty: i.qty, unitFob: i.qty ? i.amount / i.qty : 0, unitCost: i.unitCost, landed: i.amount + i.alloc, hasSample: false }))
    : (v?.items ?? []).map((i) => ({ name: i.name, itemId: i.itemId, invNo: i.invNo, qty: i.qty, unitFob: i.unitFob, unitCost: i.unitCost, landed: i.amount + i.alloc, hasSample: i.hasSample }));
  const merch = frozen ? d!.merch : v?.merch ?? 0;
  const pool = frozen ? d!.pool : v?.pool ?? 0;
  const abs = frozen ? d!.absorption : v?.absorption ?? 0;
  const byGroup = v ? (Object.keys(COST_GROUP_LABEL) as CostGroup[]).map((g) => ({ g, total: v.costs.filter((c) => c.group === g).reduce((s, c) => s + c.amount, 0), lines: v.costs.filter((c) => c.group === g) })).filter((x) => x.lines.length) : [];
  const billNums = new Set(gl.vendorBills.map((b) => b.num));

  return (
    <InventoryShell tab="shipments" companies={ctx.companies} companyId={sh.companyId} companyName={ctx.company?.legalName ?? null} glUntil={gl.coverageUntil}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href={`/inventory/shipments${q}`} className="text-xs text-slate-500 hover:underline">← Shipments</Link>
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-semibold text-slate-900">{name}</h2>
            {sh.isOpening ? pill("off", "abertura") : sh.closedAt ? pill("ok", `custos fechados em ${br(sh.closedAt.toISOString().slice(0, 10))}`) : v?.missingRefs.length ? pill("bad", "falta invoice citada") : v?.closeHint ? pill("info", "sugerido fechar custos") : pill("warn", "custos em aberto")}
          </div>
          <div className="text-xs text-slate-500">{sh.containers.length ? `containers ${sh.containers.join(" / ")} · ` : ""}entrega {br(sh.deliveredAt)}{sh.closedBy ? ` · fechado por ${sh.closedBy}` : ""}</div>
        </div>
        {!sh.isOpening && (
          <form action={renameShipment} className="flex items-center gap-2">
            <input type="hidden" name="shipmentId" value={sh.id} />
            <input name="name" defaultValue={sh.name ?? ""} placeholder="nome do embarque (ex.: Vinyl 9)" className="rounded-lg border border-slate-300 px-2 py-1 text-xs" />
            <button className="rounded-lg border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">salvar</button>
          </form>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[["Mercadoria", money(merch)], ["Frete e importação", money(pool)], ["Custo desembarcado", money(merch + pool)], ["Absorção", pct1(abs)]].map(([k, val]) => (
          <div key={k} className="rounded-xl border border-slate-200 bg-white px-4 py-3"><div className="text-[10px] uppercase tracking-wider text-slate-400">{k}</div><div className="text-lg font-extrabold text-slate-900">{val}</div></div>
        ))}
      </div>

      {v && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className={card}>
            <h2 className={h2}>Mercadoria citada na consolidação</h2>
            <ul className="text-sm">
              {v.goods.map((g) => <li key={g.id} className="flex justify-between border-t border-slate-100 py-1.5 first:border-0"><span>✓ <b className="font-mono">#{g.no}</b> <span className="text-xs text-slate-500">{br(g.date)}{billNums.has(g.no) ? " · no QBO" : ""}</span></span><span className="tabular-nums">{money(g.total)}</span></li>)}
              {v.missingRefs.map((r) => <li key={r} className="flex justify-between border-t border-slate-100 py-1.5 text-red-700"><span>✗ <b className="font-mono">#{r}</b> citada, não está aqui</span><span>—</span></li>)}
              {v.samples.map((s) => <li key={s.id} className="flex justify-between border-t border-slate-100 py-1.5 text-slate-600"><span>◦ <b className="font-mono">#{s.no}</b> sample diluído no produto</span><span className="tabular-nums">{money(s.total)}</span></li>)}
            </ul>
          </div>
          <div className={card}>
            <h2 className={h2}>Invoices de frete e custos</h2>
            <ul className="text-sm">
              {v.freights.map((f) => <li key={f.id} className="flex justify-between border-t border-slate-100 py-1.5 first:border-0"><span>✓ <b className="font-mono">#{f.no}</b> <span className="text-xs text-slate-500">{br(f.date)}{billNums.has(f.no) ? " · no QBO" : ""}</span></span><span className="tabular-nums">{money(f.total)}</span></li>)}
              {v.lateFreight.map((f) => <li key={f.id} className="flex justify-between border-t border-slate-100 py-1.5 text-amber-800"><span>＋ <b className="font-mono">#{f.no}</b> após o fechamento → COGS de {f.date.toISOString().slice(0, 7)}</span><span className="tabular-nums">{money(f.total)}</span></li>)}
            </ul>
            {byGroup.length > 0 && (
              <div className="mt-3 space-y-1 text-xs">
                {byGroup.map((g) => <div key={g.g} className="flex justify-between"><span className="text-slate-500">{COST_GROUP_LABEL[g.g]} · {g.lines.length}</span><span className="tabular-nums">{money(g.total)}</span></div>)}
                <div className="flex justify-between border-t border-slate-200 pt-1 font-semibold"><span>Total de custos (rateio por valor)</span><span className="tabular-nums">{money(v.pool)}</span></div>
              </div>
            )}
            <ShipmentNotes sh={sh} hash={notesHash(toNotesInvoices(all.filter((i) => i.shipmentId === sh.id)))} closed={!!sh.closedAt} />
            {!sh.closedAt && v.goods.length > 0 && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                {v.closeHint && <p className="mb-2 text-xs text-blue-700">A invoice de frete traz <b>{v.closeHint}</b>: sugerimos fechar os custos.</p>}
                <ActionForm action={closeShipmentCosts} submitLabel="Fechar custos" className="flex flex-wrap items-center gap-3" confirm={`Fechar os custos de ${name}? A camada entra em ${br(sh.deliveredAt)} com absorção ${pct1(abs)} e não muda mais.`}>
                  <input type="hidden" name="shipmentId" value={sh.id} />
                  <label className="flex items-center gap-1 text-[11px] text-slate-500"><input type="checkbox" name="force" value="1" /> fechar mesmo assim</label>
                </ActionForm>
              </div>
            )}
            {sh.closedAt && !sh.isOpening && (
              <form action={reopenShipment} className="mt-3 border-t border-slate-100 pt-3"><input type="hidden" name="shipmentId" value={sh.id} /><button className="text-[11px] text-slate-400 hover:text-red-600">reabrir custos (só se nenhum mês foi fechado desde a entrega)</button></form>
            )}
          </div>
        </div>
      )}

      <div className={card}>
        <h2 className={h2}>{frozen ? "Rateio por produto · camada congelada" : "Rateio por produto · prévia (custo fecha em “Fechar custos”)"}</h2>
        <table className="w-full text-sm">
          <thead><tr><th className={th}>Produto</th><th className={th}>Item QBO</th><th className={thr}>Qtd</th><th className={thr}>Unit. fábrica</th><th className={thr}>Custo unit.</th><th className={thr}>Preço p/ {margin}%</th><th className={thr}>Preço de lista</th><th className={thr}>Margem</th></tr></thead>
          <tbody>
            {rows.map((r, i) => {
              const it = r.itemId ? itemById.get(r.itemId) : null;
              const lp = it?.listPrice ? Number(it.listPrice) : null;
              const mg = lp && r.unitCost ? marginOf(r.unitCost, lp) : null;
              return (
                <tr key={i} className="border-t border-slate-100">
                  <td className={td}>{r.name}<span className="block text-[10px] text-slate-400">invoice #{r.invNo}{r.hasSample ? " · + sample" : ""}</span></td>
                  <td className={`${td} text-xs`}>{it ? it.name : <Link href={`/inventory/items${q}`} className="text-amber-700 hover:underline">sem par · confirmar</Link>}</td>
                  <td className={tdr}>{r.qty ? r.qty.toLocaleString("en-US") : "—"}</td>
                  <td className={tdr}>{money(r.unitFob)}</td>
                  <td className={`${tdr} font-semibold`}>{frozen || sh.closedAt ? money(r.unitCost) : <span className="text-slate-500">{money(r.unitCost)} ≈</span>}</td>
                  <td className={tdr}>{sh.closedAt ? money(priceForMargin(r.unitCost, margin)) : <span className="text-slate-300">após fechar</span>}</td>
                  <td className={tdr}>{lp ? money(lp) : "—"}</td>
                  <td className={`${tdr} ${mg != null && mg < margin / 100 ? "text-red-700 font-semibold" : "text-emerald-700"}`}>{mg == null ? "—" : pct1(mg)}</td>
                </tr>
              );
            })}
            <tr className="border-t-2 border-slate-200 font-bold"><td className={td}>Total · {rows.length} produtos</td><td></td><td className={tdr}>{rows.reduce((s, r) => s + r.qty, 0).toLocaleString("en-US")}</td><td></td><td className={tdr}>{money(rows.reduce((s, r) => s + r.landed, 0))}</td><td colSpan={3}></td></tr>
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-slate-400">Custo unitário = fábrica + rateio ÷ quantidade. Preço = custo ÷ (1 − margem), margem sobre o preço. Itens abaixo da margem aparecem em vermelho; o reajuste é aprovado em Items & prices.</p>
      </div>
    </InventoryShell>
  );
}
