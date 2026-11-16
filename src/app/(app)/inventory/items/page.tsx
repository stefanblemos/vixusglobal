import { prisma } from "@/lib/db";
import { inventoryContext } from "../_lib";
import { InventoryShell, Kpi, br, card, h2, money, pct1, pill, td, tdr, th, thr } from "@/components/inventory/inventory-shell";
import { ActionForm } from "@/components/inventory/action-form";
import { applySuggestedPrice, confirmPriceInQbo, importItemsCsv, mapGlName, mapVendorName, mergeItems, seedItemsFromGl, unmapGlName, updateItem } from "@/lib/actions/inventory";
import { marginOf, priceForMargin } from "@/lib/inventory/settings";
import { productName } from "@/lib/inventory/classify";
import { loadLayers } from "@/lib/inventory/fifo";

export const dynamic = "force-dynamic";

export default async function ItemsPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const ctx = await inventoryContext(company);
  const cid = ctx.companyId;
  const gl = ctx.gl;
  const margin = Number(ctx.settings?.marginPct ?? 15);
  const [items, prodLines, layers] = cid
    ? await Promise.all([
        prisma.inventoryItem.findMany({ where: { companyId: cid }, orderBy: { name: "asc" } }),
        prisma.inventoryInvoiceLine.findMany({ where: { isProduct: true, invoice: { companyId: cid } }, select: { activity: true, itemId: true, invoice: { select: { no: true, kind: true, shipment: { select: { closedAt: true, name: true, containers: true, key: true } } } } } }),
        loadLayers(cid),
      ])
    : [[], [], []];
  const known = new Set(items.flatMap((i) => [i.name, ...i.glNames]));
  const glNames = [...new Set([...Object.keys(gl?.cogsByName ?? {}), ...Object.keys(gl?.openingByName ?? {}), ...Object.keys(gl?.revenueByName ?? {})])].filter(Boolean);
  const unmappedGl = glNames.filter((n) => !known.has(n)).map((n) => ({ name: n, cogs: gl?.cogsByName[n] ?? 0, rev: gl?.revenueByName[n] ?? 0, opening: gl?.openingByName[n]?.amount ?? 0 })).sort((a, b) => b.cogs + b.opening - (a.cogs + a.opening));
  const vendorSeen = new Map<string, { invNos: Set<string>; mapped: boolean }>();
  for (const l of prodLines) {
    const k = productName(l.activity);
    const e = vendorSeen.get(k) ?? { invNos: new Set(), mapped: false };
    e.invNos.add(l.invoice.no);
    e.mapped = e.mapped || !!l.itemId;
    vendorSeen.set(k, e);
  }
  const unmappedVendor = [...vendorSeen.entries()].filter(([, v]) => !v.mapped).map(([k, v]) => ({ name: k, invNos: [...v.invNos] }));
  // absorção vigente por item (última camada) e margem realizada (GL)
  const absByItem = new Map<string, number>();
  for (const L of layers) if (L.itemId) absByItem.set(L.itemId, L.abs);
  const realized = (it: (typeof items)[number]) => {
    const names = [it.name, ...it.glNames];
    const rev = names.reduce((s, n) => s + (gl?.revenueByName[n] ?? 0), 0);
    const cogs = names.reduce((s, n) => s + (gl?.cogsByName[n] ?? 0), 0);
    const abs = absByItem.get(it.id) ?? (layers.find((L) => L.isOpening)?.abs ?? 0);
    return rev > 0 ? { rev, cogs, full: cogs * (1 + abs), mg: 1 - (cogs * (1 + abs)) / rev, abs } : null;
  };
  // custo vigente só existe com frete fechado (currentCostShipmentId). Custo do QBO é só mercadoria.
  const landed = (i: (typeof items)[number]) => (i.currentCost && i.currentCostShipmentId ? Number(i.currentCost) : null);
  const below = items.filter((i) => i.listPrice && landed(i) != null && (marginOf(landed(i)!, Number(i.listPrice)) ?? 1) < margin / 100);
  // itens em trânsito: em invoice de mercadoria cujo embarque ainda não fechou (ou nem formou)
  const transit = new Map<string, string>();
  for (const l of prodLines) if (l.itemId && l.invoice.kind === "GOODS" && !l.invoice.shipment?.closedAt) transit.set(l.itemId, l.invoice.shipment ? (l.invoice.shipment.name ?? (l.invoice.shipment.containers.length ? l.invoice.shipment.containers.join(" + ") : l.invoice.shipment.key)) : `#${l.invoice.no} sem frete`);
  // preço do app ≠ preço no QBO (último CSV): falta atualizar um dos dois
  const diverged = items.filter((i) => i.listPrice && i.qboPrice && Math.abs(Number(i.listPrice) - Number(i.qboPrice)) > 0.004);

  return (
    <InventoryShell tab="items" companies={ctx.companies} companyId={cid} companyName={ctx.company?.legalName ?? null} glUntil={gl?.coverageUntil ?? null}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi k="Itens" v={items.length} h={`${items.filter((i) => i.listPrice).length} com preço de lista`} />
        <Kpi k="Nome do fornecedor confirmado" v={items.filter((i) => i.vendorNames.length).length} h={`${unmappedVendor.length} nome(s) de invoice sem item`} />
        <Kpi k="Nomes do GL sem item" v={unmappedGl.length} h="confirme abaixo" />
        <Kpi k={`Abaixo da margem (${margin}%)`} v={below.length} h="custo com frete × preço de lista" />
        <Kpi k="Preço ≠ QBO" v={diverged.length} h={diverged.length ? "atualizar no QBO (ou reimportar o CSV)" : "lista do app bate com o QBO"} />
        <Kpi k="Margem alvo" v={`${margin}%`} h="sobre o preço · preço = custo ÷ (1 − m)" />
      </div>

      {cid && (
        <div className="flex flex-wrap gap-3">
          <div className={`${card} flex-1 min-w-[300px]`}>
            <h2 className={h2}>Carga inicial · CSV de Products and Services do QBO</h2>
            <ActionForm action={importItemsCsv} submitLabel="Importar CSV" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="companyId" value={cid} />
              <input type="file" name="file" accept=".csv,text/csv" required className="text-xs" />
            </ActionForm>
            <p className="mt-2 text-[11px] text-slate-400">Colunas esperadas (nomes flexíveis): nome do produto (com categoria “A:B:Nome”), sales price, cost, quantity on hand. Só itens de estoque. O preço entra na lista com data de hoje.</p>
          </div>
          <div className={`${card} flex-1 min-w-[300px]`}>
            <h2 className={h2}>Sem CSV · criar itens a partir do GL</h2>
            <form action={seedItemsFromGl}><input type="hidden" name="companyId" value={cid} /><button className="rounded-lg border border-[#1f3a5f] px-3 py-1.5 text-xs font-semibold text-[#1f3a5f] hover:bg-slate-50">Criar itens dos nomes do GL</button></form>
            <p className="mt-2 text-[11px] text-slate-400">Um item por nome que aparece nas vendas e na abertura do GL ({glNames.length} nomes). Sem preço: a lista vem depois, pelo CSV ou à mão.</p>
          </div>
        </div>
      )}

      {unmappedGl.length > 0 && items.length > 0 && (
        <div className={card}>
          <h2 className={h2}>Nomes do GL sem item · confirme a que item cada um pertence</h2>
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Nome no GL</th><th className={thr}>Abertura</th><th className={thr}>COGS</th><th className={thr}>Receita</th><th className={th}>É o item…</th></tr></thead>
            <tbody>
              {unmappedGl.map((u) => (
                <tr key={u.name} className="border-t border-slate-100">
                  <td className={td}>{u.name}</td><td className={tdr}>{money(u.opening)}</td><td className={tdr}>{money(u.cogs)}</td><td className={tdr}>{money(u.rev)}</td>
                  <td className={td}>
                    <form action={mapGlName} className="flex items-center gap-1">
                      <input type="hidden" name="glName" value={u.name} />
                      <select name="itemId" defaultValue={items.filter((i) => i.name.length >= 4 && u.name.endsWith(i.name)).sort((a, b) => b.name.length - a.name.length)[0]?.id ?? ""} className="max-w-[320px] rounded border border-slate-200 px-1 py-0.5 text-xs"><option value="">escolher…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
                      <button className="rounded border border-[#1f3a5f] px-2 py-0.5 text-[11px] font-semibold text-[#1f3a5f]">confirmar</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-slate-400">A sugestão pré-selecionada é só o nome que termina igual; nada é confirmado sem o seu clique. Sem confirmação, as vendas desse nome não consomem camada e caem em “vendido sem camada”. Nomes quase iguais (ex.: vinyl “plus”) são itens diferentes: crie o item em vez de confirmar.</p>
        </div>
      )}

      {unmappedVendor.length > 0 && items.length > 0 && (
        <div className={card}>
          <h2 className={h2}>Nomes nas invoices do fornecedor sem item</h2>
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Nome na invoice</th><th className={th}>Invoices</th><th className={th}>É o item…</th></tr></thead>
            <tbody>
              {unmappedVendor.map((u) => (
                <tr key={u.name} className="border-t border-slate-100">
                  <td className={td}>{u.name}</td><td className={`${td} text-xs text-slate-500`}>{u.invNos.map((n) => "#" + n).join(", ")}</td>
                  <td className={td}>
                    <form action={mapVendorName} className="flex items-center gap-1">
                      <input type="hidden" name="vendorName" value={u.name} />
                      <select name="itemId" className="max-w-[320px] rounded border border-slate-200 px-1 py-0.5 text-xs"><option value="">escolher…</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</select>
                      <button className="rounded border border-[#1f3a5f] px-2 py-0.5 text-[11px] font-semibold text-[#1f3a5f]">confirmar</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className={card}>
        <h2 className={h2}>Itens · custo vigente, preço de lista e margem</h2>
        {items.length === 0 ? <p className="text-sm text-slate-500">Nenhum item. Importe o CSV do QBO ou crie a partir do GL.</p> : (
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Item (QBO)</th><th className={th}>Nomes · fornecedor / GL</th><th className={thr}>Custo com frete</th><th className={thr}>Preço de lista</th><th className={thr}>Margem</th><th className={thr}>Preço p/ {margin}%</th><th className={thr}>Realizada (GL)</th><th className={th}></th></tr></thead>
            <tbody>
              {items.map((i) => {
                const cost = landed(i);
                const lp = i.listPrice ? Number(i.listPrice) : null;
                const qp = i.qboPrice ? Number(i.qboPrice) : null;
                const div = lp != null && qp != null && Math.abs(lp - qp) > 0.004;
                const tr = transit.get(i.id);
                const mg = cost && lp ? marginOf(cost, lp) : null;
                const rz = realized(i);
                const low = mg != null && mg < margin / 100;
                return (
                  <tr key={i.id} className="border-t border-slate-100">
                    <td className={td}>{i.name}{i.category && <span className="block text-[10px] text-slate-400">{i.category}</span>}{!i.active && pill("off", "inativo")}</td>
                    <td className={`${td} text-[11px] text-slate-500`}>
                      {i.vendorNames.length ? i.vendorNames.join(" · ") : <span className="text-slate-300">fornecedor: —</span>}
                      <div>{i.glNames.filter((g) => g !== i.name).map((g) => <span key={g} className="mr-1 inline-flex items-center gap-0.5 rounded bg-slate-100 px-1">{g}<form action={unmapGlName} className="inline"><input type="hidden" name="itemId" value={i.id} /><input type="hidden" name="glName" value={g} /><button className="text-slate-400 hover:text-red-600">×</button></form></span>)}</div>
                    </td>
                    <td className={tdr}>
                      {cost != null ? <>{money(cost)}<span className="block text-[10px] text-slate-400">{br(i.currentCostAt)}</span></> : <span className="text-slate-400">—</span>}
                      {tr && <span className="block text-[10px] text-amber-700">em trânsito · {tr}</span>}
                      {cost == null && i.qboCost && <span className="block text-[10px] text-slate-400">QBO s/ frete {money(Number(i.qboCost))}</span>}
                    </td>
                    <td className={tdr}>
                      <form action={updateItem} className="flex items-center justify-end gap-1">
                        <input type="hidden" name="itemId" value={i.id} />
                        <input name="listPrice" defaultValue={lp ?? ""} placeholder="—" className="w-24 rounded border border-slate-200 px-1 py-0.5 text-right text-xs" />
                        <button className="text-[10px] text-slate-400 hover:text-[#1f3a5f]">ok</button>
                      </form>
                      {i.listPriceAt && <span className="block text-[10px] text-slate-400">{br(i.listPriceAt)}</span>}
                      {div && <span className="block text-[10px] font-semibold text-red-700">QBO {money(qp)} ≠ app</span>}
                    </td>
                    <td className={`${tdr} font-semibold ${low ? "text-red-700" : mg != null ? "text-emerald-700" : ""}`}>{mg == null ? "—" : pct1(mg)}</td>
                    <td className={tdr}>{cost ? money(priceForMargin(cost, margin)) : "—"}</td>
                    <td className={`${tdr} ${rz && rz.mg < margin / 100 ? "text-red-700" : "text-slate-600"}`}>{rz ? <>{pct1(rz.mg)}<span className="block text-[10px] text-slate-400">abs {pct1(rz.abs)} · rec {money(rz.rev, 0)}</span></> : "—"}</td>
                    <td className={td}>
                      {low && cost != null && <form action={applySuggestedPrice}><input type="hidden" name="itemId" value={i.id} /><button className="rounded border border-red-300 px-2 py-0.5 text-[11px] font-semibold text-red-700 hover:bg-red-50">aplicar {money(priceForMargin(cost, margin))}</button></form>}
                      {div && <form action={confirmPriceInQbo} className="mt-0.5"><input type="hidden" name="itemId" value={i.id} /><button className="rounded border border-slate-300 px-2 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50" title="Marque depois de digitar este preço no QBO">já atualizei no QBO</button></form>}
                      <details className="text-[10px] text-slate-400">
                        <summary className="cursor-pointer hover:text-[#1f3a5f]">é o mesmo item que…</summary>
                        <form action={mergeItems} className="mt-1 flex items-center gap-1">
                          <input type="hidden" name="fromId" value={i.id} />
                          <select name="intoId" className="max-w-[220px] rounded border border-slate-200 px-1 py-0.5 text-[10px]"><option value="">este vira…</option>{items.filter((o) => o.id !== i.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select>
                          <button className="rounded border border-slate-300 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">juntar</button>
                        </form>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] text-slate-400">Custo vigente = custo desembarcado do último embarque fechado que trouxe o item. Margem = 1 − custo ÷ preço de lista. Realizada = pelo GL: 1 − COGS material × (1 + absorção da camada vigente) ÷ receita.</p>
      </div>
    </InventoryShell>
  );
}
