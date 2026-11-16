import Link from "next/link";
import { prisma } from "@/lib/db";
import { inventoryContext } from "../_lib";
import { InventoryShell, Kpi, br, card, h2, money, money0, pct1, td, tdr, th, thr } from "@/components/inventory/inventory-shell";
import { runFifo } from "@/lib/inventory/fifo";

export const dynamic = "force-dynamic";

export default async function StockPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const ctx = await inventoryContext(company);
  const cid = ctx.companyId;
  const res = cid && ctx.settings ? await runFifo(cid, ctx.settings) : null;
  const openShips = cid ? await prisma.inventoryShipment.findMany({ where: { companyId: cid, closedAt: null }, select: { id: true, name: true, containers: true, key: true, deliveredAt: true } }) : [];
  const last = res?.rows[res.rows.length - 1] ?? null;
  const layers = res?.layers ?? [];
  const byItem = new Map<string, typeof layers>();
  for (const L of layers) (byItem.get(L.itemName) ?? byItem.set(L.itemName, []).get(L.itemName)!).push(L);
  const groups = [...byItem.entries()].map(([name, ls]) => ({ name, ls, left: ls.reduce((s, l) => s + l.left, 0), freight: ls.reduce((s, l) => s + l.left * l.abs, 0) })).filter((g) => g.left > 0.005).sort((a, b) => b.left - a.left);
  const matLeft = groups.reduce((s, g) => s + g.left, 0);
  const frLeft = groups.reduce((s, g) => s + g.freight, 0);
  const q = `?company=${cid}`;

  return (
    <InventoryShell tab="stock" companies={ctx.companies} companyId={cid} companyName={ctx.company?.legalName ?? null} glUntil={ctx.gl?.coverageUntil ?? null}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi k="Material em estoque (camadas)" v={money0(matLeft)} h="a custo de fábrica" />
        <Kpi k="Material no GL" v={money0(last?.glMatStock ?? null)} h={last ? `Inventory Asset em ${last.month}` : "—"} />
        <Kpi k="Frete em estoque · deveria" v={money0(frLeft)} h="Σ saldo × absorção" />
        <Kpi k="Frete no GL" v={money0(last?.glFreightStock ?? null)} h="Freight & Handling" />
        <Kpi k="Frete a regularizar" v={money0(last && last.glFreightStock != null ? last.glFreightStock - frLeft : null)} h="GL − deveria · ver Month-end" />
      </div>
      <div className="grid gap-3 md:grid-cols-[2fr_1fr]">
        <div className={card}>
          <h2 className={h2}>Camadas por item (FIFO por item){last ? ` · posição em ${last.month}` : ""}</h2>
          {groups.length === 0 ? <p className="text-sm text-slate-500">Sem camadas. Crie a abertura (Settings) ou feche os custos de um embarque.</p> : (
            <table className="w-full text-sm">
              <thead><tr><th className={th}>Item</th><th className={th}>Camada</th><th className={thr}>Entrou</th><th className={thr}>Material restante</th><th className={thr}>Absorção</th><th className={thr}>Frete restante</th></tr></thead>
              <tbody>
                {groups.map((g) => g.ls.filter((L) => L.left > 0.005 || g.ls.length > 1).map((L, i) => (
                  <tr key={`${g.name}-${i}`} className="border-t border-slate-100">
                    <td className={td}>{i === 0 ? g.name : ""}</td><td className={`${td} text-xs text-slate-500`}>{L.shipmentName} · {L.month}</td><td className={`${tdr} text-slate-500`}>{money(L.mat)}</td><td className={tdr}>{money(L.left)}</td><td className={tdr}>{pct1(L.abs)}</td><td className={tdr}>{money(L.left * L.abs)}</td>
                  </tr>
                )))}
                <tr className="border-t-2 border-slate-200 font-bold"><td className={td}>Total · {groups.length} itens</td><td></td><td></td><td className={tdr}>{money(matLeft)}</td><td className={tdr}>{pct1(matLeft ? frLeft / matLeft : 0)}</td><td className={tdr}>{money(frLeft)}</td></tr>
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-slate-400">Material = valor de fábrica que sobrou (entradas menos as vendas do GL, item a item). Frete = material × absorção da camada. Zerou o material, zerou o frete.</p>
        </div>
        <div className={card}>
          <h2 className={h2}>Alertas</h2>
          <ul className="space-y-2 text-xs">
            {res && Object.entries(res.unmappedGlNames).map(([n, v]) => <li key={n} className="rounded-lg bg-red-50 px-3 py-2 text-red-800"><b>Vendido sem camada</b> — {n}: {money(v)} de COGS sem lote entregue. <Link href={`/inventory/items${q}`} className="underline">Confirmar item</Link> ou fechar o embarque que o trouxe.</li>)}
            {last && last.glMatStock != null && Math.abs(last.glMatStock - matLeft) > 1 && <li className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800"><b>Material GL × camadas</b> diferem em {money(last.glMatStock - matLeft)}: custo médio do QBO × FIFO, entradas ainda não fechadas, ou nomes sem item.</li>}
            {openShips.map((s) => <li key={s.id} className="rounded-lg bg-amber-50 px-3 py-2 text-amber-800"><b>{s.name ?? (s.containers.length ? s.containers.join(" + ") : s.key)}</b> com custos em aberto — entrará em {br(s.deliveredAt)} ao <Link href={`/inventory/shipments/${s.id}${q}`} className="underline">fechar custos</Link>.</li>)}
            {res && !Object.keys(res.unmappedGlNames).length && !openShips.length && <li className="text-slate-500">Nada pendente.</li>}
          </ul>
        </div>
      </div>
    </InventoryShell>
  );
}
