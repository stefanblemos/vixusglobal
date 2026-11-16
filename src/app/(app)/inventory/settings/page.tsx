import { prisma } from "@/lib/db";
import { inventoryContext } from "../_lib";
import { InventoryShell, br, card, h2, money, pill } from "@/components/inventory/inventory-shell";
import { ActionForm } from "@/components/inventory/action-form";
import { createOpening, deleteVendor, saveInventorySettings, saveVendor, updateOpening } from "@/lib/actions/inventory";

export const dynamic = "force-dynamic";

const input = "w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm outline-none focus:border-[#8DC63F]";
const label = "mb-1 block text-xs font-medium text-slate-600";

type VendorRow = { id: string; name: string; aliases: string[]; closeHintTerms: string[]; waitDays: number; active: boolean; notes: string | null };

function VendorForm({ cid, v, invoices }: { cid: string; v: VendorRow | null; invoices: number }) {
  return (
    <ActionForm action={saveVendor} submitLabel={v ? "Salvar" : "Incluir fornecedor"} className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <input type="hidden" name="companyId" value={cid} />
      {v && <input type="hidden" name="id" value={v.id} />}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className="col-span-2"><label className={label}>Nome (como aparece no QBO)</label><input name="name" defaultValue={v?.name ?? ""} required className={input} /></div>
        <div><label className={label}>Aviso sem frete (dias)</label><input name="waitDays" defaultValue={v?.waitDays ?? 30} className={input} /></div>
        <div><label className={label}>Situação</label>
          <select name="active" defaultValue={v && !v.active ? "0" : "1"} className={input}><option value="1">Ativo</option><option value="0">Inativo</option></select>
        </div>
        <div className="col-span-2"><label className={label}>Outras grafias no GL (vírgula)</label><input name="aliases" defaultValue={v?.aliases.join(", ") ?? ""} placeholder="ex.: Archway, ARCHWAY TRADE" className={input} /></div>
        <div className="col-span-2"><label className={label}>Termos que sugerem “fechar custos” (vírgula)</label><input name="closeHintTerms" defaultValue={v ? v.closeHintTerms.join(", ") : "cross-dock, cross dock, unloading, delivery"} className={input} /></div>
        <div className="col-span-2 md:col-span-4"><label className={label}>Observações</label><input name="notes" defaultValue={v?.notes ?? ""} className={input} /></div>
      </div>
      {v && <p className="text-[11px] text-slate-400">{invoices} invoice(s) deste fornecedor. {invoices ? "Para parar de usar, marque Inativo." : ""}</p>}
    </ActionForm>
  );
}

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const ctx = await inventoryContext(company);
  const cid = ctx.companyId;
  const s = ctx.settings;
  const gl = ctx.gl;
  const [opening, vendors, closedShips, invByVendor] = cid
    ? await Promise.all([
        prisma.inventoryShipment.findFirst({ where: { companyId: cid, isOpening: true } }),
        prisma.inventoryVendor.findMany({ where: { companyId: cid }, orderBy: [{ active: "desc" }, { createdAt: "asc" }] }),
        prisma.inventoryShipment.count({ where: { companyId: cid, isOpening: false, closedAt: { not: null } } }),
        prisma.inventoryInvoice.groupBy({ by: ["vendorName"], where: { companyId: cid }, _count: { _all: true } }),
      ])
    : [null, [], 0, []];
  const invCount = new Map(invByVendor.map((g) => [g.vendorName, g._count._all]));
  const openItems = Object.entries(gl?.openingByName ?? {}).filter(([, v]) => v.amount > 0.005);
  const openTotal = openItems.reduce((x, [, v]) => x + v.amount, 0);
  const openDate = openItems.map(([, v]) => v.date).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
  const firstFreightIn = Object.entries(gl?.freightCapitalizedByMonth ?? {}).sort()[0] ?? null;
  const od = opening?.closedData as { merch: number; pool: number; absorption: number } | undefined;

  return (
    <InventoryShell tab="settings" companies={ctx.companies} companyId={cid} companyName={ctx.company?.legalName ?? null} glUntil={gl?.coverageUntil ?? null}>
      {cid && s && (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            <div className={card}>
              <h2 className={h2}>Regras da empresa</h2>
              <ActionForm action={saveInventorySettings} submitLabel="Salvar">
                <input type="hidden" name="companyId" value={cid} />
                <div className="grid grid-cols-2 gap-3">
                  <div><label className={label}>Margem sobre o preço (%)</label><input name="marginPct" defaultValue={Number(s.marginPct)} className={input} /><p className="mt-1 text-[11px] text-slate-400">preço = custo ÷ (1 − margem)</p></div>
                  <div><label className={label}>Livros fechados até (mês)</label><input name="booksClosedThrough" type="month" defaultValue={s.booksClosedThrough ?? ""} className={input} /><p className="mt-1 text-[11px] text-slate-400">meses até aqui são só leitura; o ajuste acumulado entra no 1º mês aberto. Vazio = ano passado.</p></div>
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
              {opening && od ? (
                <>
                  <p className="mb-3 text-sm text-slate-700">Abertura em <b>{br(opening.deliveredAt)}</b>: material {money(od.merch)} · frete {money(od.pool)} · absorção {(od.absorption * 100).toFixed(1)}%.</p>
                  <ActionForm action={updateOpening} submitLabel="Atualizar abertura">
                    <input type="hidden" name="companyId" value={cid} />
                    <div className="grid grid-cols-2 gap-3">
                      <div><label className={label}>Data da abertura</label><input name="date" type="date" defaultValue={opening.deliveredAt?.toISOString().slice(0, 10) ?? ""} required className={input} /></div>
                      <div><label className={label}>Frete capitalizado na abertura ($)</label><input name="freight" defaultValue={od.pool} required className={input} /></div>
                    </div>
                    <p className="text-[11px] text-slate-400">
                      O material por item vem do GL e não se edita aqui. {closedShips ? <>Como já há <b>{closedShips}</b> embarque(s) com custos fechados, só um administrador consegue alterar.</> : "Pode ser corrigida livremente até o primeiro embarque ter os custos fechados."}
                    </p>
                  </ActionForm>
                </>
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

          <div className={card}>
            <h2 className={h2}>Fornecedores de importação</h2>
            <p className="mb-3 text-xs text-slate-500">Cada fornecedor tem suas regras. O nome e as grafias servem para achar as bills dele no GL; os termos de fechamento e o prazo de aviso valem para as invoices dele.</p>
            <div className="space-y-3">
              {vendors.map((v) => (
                <details key={v.id} className="group rounded-lg border border-slate-200" open={vendors.length === 1}>
                  <summary className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                    <span className="font-semibold text-slate-800">{v.name}</span>
                    {v.active ? pill("ok", "ativo") : pill("off", "inativo")}
                    <span className="text-xs text-slate-500">{invCount.get(v.name) ?? 0} invoice(s) · aviso {v.waitDays} dias · termos: {v.closeHintTerms.join(", ") || "—"}{v.aliases.length ? ` · grafias: ${v.aliases.join(", ")}` : ""}</span>
                    <span className="ml-auto text-[11px] text-slate-400 group-open:hidden">editar</span>
                  </summary>
                  <div className="space-y-2 px-3 pb-3">
                    <VendorForm cid={cid} v={v} invoices={invCount.get(v.name) ?? 0} />
                    {!(invCount.get(v.name) ?? 0) && vendors.length > 1 && (
                      <ActionForm action={deleteVendor} submitLabel="Excluir fornecedor" submitClass="rounded border border-red-200 px-2 py-0.5 text-[11px] text-red-700" className="flex justify-end">
                        <input type="hidden" name="id" value={v.id} />
                      </ActionForm>
                    )}
                  </div>
                </details>
              ))}
              <details className="rounded-lg border border-dashed border-slate-300">
                <summary className="cursor-pointer px-3 py-2 text-sm text-[#1f3a5f]">＋ Novo fornecedor</summary>
                <div className="px-3 pb-3"><VendorForm cid={cid} v={null} invoices={0} /></div>
              </details>
            </div>
          </div>
        </>
      )}
    </InventoryShell>
  );
}
