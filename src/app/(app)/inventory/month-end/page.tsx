import { prisma } from "@/lib/db";
import { inventoryContext } from "../_lib";
import { InventoryShell, Kpi, br, card, h2, mesBr, money, money0, pill, td, tdr, th, thr } from "@/components/inventory/inventory-shell";
import { ActionForm } from "@/components/inventory/action-form";
import { runFifo } from "@/lib/inventory/fifo";
import { closeMonth, deleteClosing, markJeBooked } from "@/lib/actions/inventory";
import type { ClosedData } from "@/lib/inventory/shipments";

export const dynamic = "force-dynamic";

export default async function MonthEndPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const ctx = await inventoryContext(company);
  const cid = ctx.companyId;
  const s = ctx.settings;
  const res = cid && s ? await runFifo(cid, s) : null;
  const rows = res?.rows ?? [];
  const gl = ctx.gl;
  const open = rows.filter((r) => r.suggested > 0.005 && r.posted < 0.005 && !(r.closing?.jeBookedAt));
  const firstOpen = open[0] ?? null;
  const closedShips = cid ? await prisma.inventoryShipment.findMany({ where: { companyId: cid, closedAt: { not: null } }, select: { name: true, key: true, containers: true, isOpening: true, closedData: true, invoices: { where: { kind: "FREIGHT" }, select: { no: true, total: true, date: true } } } }) : [];
  const sysCap = closedShips.reduce((x, sh) => x + ((sh.closedData as unknown as ClosedData | null)?.pool ?? 0), 0);
  const glCap = Object.values(gl?.freightCapitalizedByMonth ?? {}).reduce((x, v) => x + v, 0);
  const billNums = new Set((gl?.vendorBills ?? []).map((b) => b.num));
  const freightNotInGl = closedShips.flatMap((sh) => sh.invoices.filter((i) => !billNums.has(i.no) && gl?.coverageUntil && i.date.getTime() <= gl.coverageUntil.getTime()).map((i) => ({ ship: sh.name ?? sh.key, no: i.no, total: Number(i.total) })));
  const freightGlAccounts = (gl?.vendorBills ?? []).filter((b) => s && b.account !== s.glInventoryAccount && b.account !== s.glFreightAccount && !/Accounts Payable/i.test(b.account));
  const je = (r: (typeof rows)[number]) => `Data: ${r.month}-${new Date(Date.UTC(Number(r.month.slice(0, 4)), Number(r.month.slice(5, 7)), 0)).getUTCDate()}\nDébito   ${s?.glCogsFreightAccount ?? "Shipping and Handling"}${" ".repeat(Math.max(1, 44 - (s?.glCogsFreightAccount.length ?? 21)))}${r.suggested.toFixed(2)}\nCrédito  ${s?.glFreightAccount ?? "Inventory Asset - Freight & Handling"}${" ".repeat(Math.max(1, 44 - (s?.glFreightAccount.length ?? 36)))}${r.suggested.toFixed(2)}\nMemo: Adjustment of inventory — frete de importação ${r.month} (Vixus)${r.lateAdj ? ` · inclui ${r.lateAdj.toFixed(2)} de frete tardio` : ""}`;

  return (
    <InventoryShell tab="month-end" companies={ctx.companies} companyId={cid} companyName={ctx.company?.legalName ?? null} glUntil={gl?.coverageUntil ?? null}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi k="Meses com JE pendente" v={open.length} h={open.length ? `desde ${mesBr(open[0].month)}` : "em dia"} />
        <Kpi k="Frete a apropriar (pendente)" v={money0(open.reduce((x, r) => x + r.suggested, 0))} h="soma das JEs sugeridas" />
        <Kpi k="Frete em estoque · deveria" v={money0(rows[rows.length - 1]?.shouldFreightStock ?? null)} h={rows.length ? rows[rows.length - 1].month : "—"} />
        <Kpi k="Frete em estoque · GL" v={money0(rows[rows.length - 1]?.glFreightStock ?? null)} h={gl?.coverageUntil ? `até ${br(gl.coverageUntil)}` : "—"} />
        <Kpi k="Capitalizado · sistema × GL" v={<span className="text-sm">{money0(sysCap)} × {money0(glCap)}</span>} h={Math.abs(sysCap - glCap) > 1 ? `diferença ${money0(sysCap - glCap)} · ver conferência` : "batem"} />
      </div>

      <div className={card}>
        <h2 className={h2}>Frete a apropriar · sugerido × lançado no QBO, mês a mês</h2>
        {rows.length === 0 ? <p className="text-sm text-slate-500">Sem camadas nem movimento. Crie a abertura em Settings.</p> : (
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Mês</th><th className={thr}>COGS material (GL)</th><th className={thr}>Frete sugerido</th><th className={thr}>Lançado (GL)</th><th className={thr}>Diferença</th><th className={thr}>Estoque frete · deveria</th><th className={thr}>Estoque frete · GL</th><th className={th}>Situação</th><th className={th}></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const booked = r.posted > 0.005 || !!r.closing?.jeBookedAt;
                const ok = booked && Math.abs(r.diff) < Math.max(500, r.suggested * 0.1);
                const st = r.matOut < 0.005 && r.suggested < 0.005 ? pill("off", "sem movimento") : booked ? (ok ? pill("ok", r.posted > 0.005 ? "conferido no GL" : "marcado como lançado") : pill("warn", "lançado ≠ sugerido")) : pill("bad", "JE pendente");
                return (
                  <tr key={r.month} className="border-t border-slate-100">
                    <td className={`${td} font-semibold`}>{mesBr(r.month)}{r.closing && <span className="block text-[10px] font-normal text-slate-400">fechado · {r.closing.merchEndSource}</span>}</td>
                    <td className={tdr}>{money(r.matOut)}{r.matOut - r.matOutMatched > 0.5 && <span className="block text-[10px] text-red-600">{money(r.matOut - r.matOutMatched)} sem camada</span>}</td>
                    <td className={`${tdr} font-semibold`}>{money(r.suggested)}{r.lateAdj > 0 && <span className="block text-[10px] text-amber-700">inclui tardio {money(r.lateAdj)}</span>}</td>
                    <td className={tdr}>{r.posted > 0.005 ? money(r.posted) : r.closing?.jeBookedAt ? <span className="text-slate-500">{money(r.closing.jeBookedAmount)} (manual)</span> : "—"}</td>
                    <td className={`${tdr} ${r.diff > 0.5 ? "text-red-700" : r.diff < -0.5 ? "text-emerald-700" : ""}`}>{money(r.diff)}</td>
                    <td className={tdr}>{money(r.shouldFreightStock)}</td>
                    <td className={tdr}>{r.glFreightStock == null ? "—" : money(r.glFreightStock)}</td>
                    <td className={td}>{st}</td>
                    <td className={`${td} text-[11px]`}>
                      {cid && !r.closing && r.suggested > 0.005 && (
                        <ActionForm action={closeMonth} submitLabel="fechar mês" submitClass="rounded border border-[#1f3a5f] px-2 py-0.5 text-[11px] font-semibold text-[#1f3a5f]" className="flex items-center gap-1">
                          <input type="hidden" name="companyId" value={cid} /><input type="hidden" name="month" value={r.month} />
                          {r.glMatStock == null && <input name="merchEnd" placeholder="estoque final $" className="w-28 rounded border border-slate-200 px-1 py-0.5 text-[11px]" />}
                        </ActionForm>
                      )}
                      {cid && r.closing && !r.closing.jeBookedAt && r.posted < 0.005 && (
                        <form action={markJeBooked} className="flex items-center gap-1"><input type="hidden" name="companyId" value={cid} /><input type="hidden" name="month" value={r.month} /><input type="date" name="date" className="rounded border border-slate-200 px-1 py-0.5 text-[11px]" /><button className="text-[#1f3a5f] hover:underline">marcar lançado</button></form>
                      )}
                      {cid && r.closing?.jeBookedAt && r.posted < 0.005 && <form action={markJeBooked}><input type="hidden" name="companyId" value={cid} /><input type="hidden" name="month" value={r.month} /><input type="hidden" name="undo" value="1" /><button className="text-slate-400 hover:underline">desmarcar</button></form>}
                      {cid && r.closing && <form action={deleteClosing}><input type="hidden" name="companyId" value={cid} /><input type="hidden" name="month" value={r.month} /><button className="text-slate-300 hover:text-red-600">reabrir</button></form>}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-slate-200 font-bold"><td className={td}>Total</td><td className={tdr}>{money(rows.reduce((x, r) => x + r.matOut, 0))}</td><td className={tdr}>{money(rows.reduce((x, r) => x + r.suggested, 0))}</td><td className={tdr}>{money(rows.reduce((x, r) => x + r.posted, 0))}</td><td className={tdr}>{money(rows.reduce((x, r) => x + r.diff, 0))}</td><td colSpan={4}></td></tr>
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] text-slate-400">COGS material e “lançado” vêm do GL. Sugerido = FIFO por item com a absorção de cada camada (+ frete que chegou após o fechamento do embarque). Quando o GL do mês seguinte subir com a JE, a linha confere sozinha. O estoque final de material usado no fechamento é o saldo do GL; só é digitado quando o GL do mês ainda não subiu.</p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={card}>
          <h2 className={h2}>{firstOpen ? `JE sugerida · ${mesBr(firstOpen.month)} (primeiro mês em aberto)` : "JE sugerida"}</h2>
          {firstOpen ? (
            <>
              <pre className="whitespace-pre-wrap rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs">{je(firstOpen)}</pre>
              {open.length > 1 && <p className="mt-2 text-[11px] text-slate-500">Depois: {open.slice(1).map((r) => `${mesBr(r.month)} ${money(r.suggested)}`).join(" · ")}. Uma JE por mês, com a data de cada mês.</p>}
            </>
          ) : <p className="text-sm text-slate-500">Nenhuma JE pendente.</p>}
        </div>
        <div className={card}>
          <h2 className={h2}>Conferência do capitalizado · sistema × GL</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500">Frete capitalizado no sistema (abertura + embarques fechados)</dt><dd className="text-right tabular-nums">{money(sysCap)}</dd>
            <dt className="text-slate-500">Entradas na conta de frete no GL</dt><dd className="text-right tabular-nums">{money(glCap)}</dd>
            <dt className="font-semibold">Diferença</dt><dd className="text-right font-bold tabular-nums text-[#1f3a5f]">{money(sysCap - glCap)}</dd>
          </dl>
          {freightNotInGl.length > 0 && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><b>Invoices de frete fechadas que não estão no QBO:</b> {freightNotInGl.map((f) => `#${f.no} ${money(f.total)}`).join(", ")}.</div>}
          {freightGlAccounts.length > 0 && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800"><b>Bills do fornecedor lançadas fora do estoque</b> (reclassificar para {s?.glFreightAccount}, conforme decidido): {freightGlAccounts.map((b) => `#${b.num} ${b.account} ${money(b.amount)}`).join(" · ")}.</div>}
          <p className="mt-2 text-[11px] text-slate-400">Serviços e bank charges da Archway entram no custo do embarque (capitalizados). Enquanto o contador os lançar em despesa, as duas colunas não batem.</p>
        </div>
      </div>
    </InventoryShell>
  );
}
