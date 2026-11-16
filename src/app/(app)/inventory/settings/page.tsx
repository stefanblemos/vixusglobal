import { prisma } from "@/lib/db";
import { inventoryContext } from "../_lib";
import { InventoryShell, br, card, h2, money } from "@/components/inventory/inventory-shell";
import { ActionForm } from "@/components/inventory/action-form";
import { createOpening, saveInventorySettings } from "@/lib/actions/inventory";

export const dynamic = "force-dynamic";

const input = "w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#8DC63F]";
const label = "mb-1 block text-xs font-medium text-slate-600";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const ctx = await inventoryContext(company);
  const cid = ctx.companyId;
  const s = ctx.settings;
  const gl = ctx.gl;
  const opening = cid ? await prisma.inventoryShipment.findFirst({ where: { companyId: cid, isOpening: true } }) : null;
  const openItems = Object.entries(gl?.openingByName ?? {}).filter(([, v]) => v.amount > 0.005);
  const openTotal = openItems.reduce((x, [, v]) => x + v.amount, 0);
  const openDate = openItems.map(([, v]) => v.date).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const firstFreightIn = Object.entries(gl?.freightCapitalizedByMonth ?? {}).sort()[0] ?? null;

  return (
    <InventoryShell tab="settings" companies={ctx.companies} companyId={cid} companyName={ctx.company?.legalName ?? null} glUntil={gl?.coverageUntil ?? null}>
      {cid && s && (
        <div className="grid gap-3 md:grid-cols-2">
          <div className={card}>
            <h2 className={h2}>Regras</h2>
            <ActionForm action={saveInventorySettings} submitLabel="Salvar">
              <input type="hidden" name="companyId" value={cid} />
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Margem sobre o preço (%)</label><input name="marginPct" defaultValue={Number(s.marginPct)} className={input} /><p className="mt-1 text-[11px] text-slate-400">preço = custo ÷ (1 − margem)</p></div>
                <div><label className={label}>Aviso de mercadoria sem frete (dias)</label><input name="waitDays" defaultValue={s.waitDays} className={input} /></div>
                <div className="col-span-2"><label className={label}>Termos que sugerem “fechar custos” (na invoice de frete)</label><input name="closeHintTerms" defaultValue={s.closeHintTerms.join(", ")} className={input} /></div>
                <div className="col-span-2"><label className={label}>Fornecedor (como aparece no QBO)</label><input name="vendorName" defaultValue={s.vendorName} className={input} /></div>
              </div>
              <h3 className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-slate-400">Contas do QBO</h3>
              <div className="grid grid-cols-2 gap-3">
                <div><label className={label}>Estoque de material</label><input name="glInventoryAccount" defaultValue={s.glInventoryAccount} className={input} /></div>
                <div><label className={label}>Estoque de frete capitalizado</label><input name="glFreightAccount" defaultValue={s.glFreightAccount} className={input} /></div>
                <div><label className={label}>COGS de material</label><input name="glCogsMaterialAccount" defaultValue={s.glCogsMaterialAccount} className={input} /></div>
                <div><label className={label}>COGS de frete (JE mensal)</label><input name="glCogsFreightAccount" defaultValue={s.glCogsFreightAccount} className={input} /></div>
              </div>
            </ActionForm>
          </div>
          <div className={card}>
            <h2 className={h2}>Camada de abertura (saldos do GL)</h2>
            {opening ? (
              <p className="text-sm text-slate-700">Abertura criada em {br(opening.deliveredAt)}: material {money((opening.closedData as { merch: number }).merch)} · frete {money((opening.closedData as { pool: number }).pool)} · absorção {(((opening.closedData as { absorption: number }).absorption) * 100).toFixed(1)}%.</p>
            ) : openItems.length === 0 ? (
              <p className="text-sm text-slate-500">O GL desta empresa não tem “Inventory Starting Value”. Suba o GL (Uploads) e volte aqui.</p>
            ) : (
              <ActionForm action={createOpening} submitLabel="Criar abertura">
                <input type="hidden" name="companyId" value={cid} />
                <p className="text-sm text-slate-700">O GL traz <b>{openItems.length} itens</b> de abertura somando <b>{money(openTotal)}</b> de material{openDate ? `, a partir de ${br(openDate)}` : ""}. Informe o frete capitalizado na mesma data{firstFreightIn ? ` (GL: primeira entrada na conta de frete em ${firstFreightIn[0]}, ${money(firstFreightIn[1])})` : ""}.</p>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={label}>Data da abertura</label><input name="date" type="date" defaultValue={openDate?.toISOString().slice(0, 10) ?? ""} required className={input} /></div>
                  <div><label className={label}>Frete capitalizado na abertura ($)</label><input name="freight" defaultValue={firstFreightIn ? firstFreightIn[1] : ""} required className={input} /></div>
                </div>
                <p className="text-[11px] text-slate-400">Cria uma camada por item com a absorção única (frete ÷ material). Cada item do GL vira um item aqui, se ainda não existir.</p>
              </ActionForm>
            )}
          </div>
        </div>
      )}
    </InventoryShell>
  );
}
