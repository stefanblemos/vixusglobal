import { prisma } from "@/lib/db";
import { inventoryContext } from "../_lib";
import { InventoryShell, Kpi, br, card, h2, mesBr, money, money0, pill, td, tdr, th, thr } from "@/components/inventory/inventory-shell";
import { ActionForm } from "@/components/inventory/action-form";
import { runFifo } from "@/lib/inventory/fifo";
import { closeMonth, deleteClosing, markJeBooked } from "@/lib/actions/inventory";
import type { ClosedData } from "@/lib/inventory/shipments";
import { isClosedBooks } from "@/lib/inventory/settings";

export const dynamic = "force-dynamic";

export default async function MonthEndPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const { company } = await searchParams;
  const ctx = await inventoryContext(company);
  const cid = ctx.companyId;
  const s = ctx.settings;
  const res = cid && s ? await runFifo(cid, s) : null;
  const rows = res?.rows ?? [];
  const gl = ctx.gl;
  const closedBooks = (m: string) => (s ? isClosedBooks(s, m) : false);
  const booked = (r: (typeof rows)[number]) => r.posted > 0.005 || !!r.closing?.jeBookedAt;
  // pendente = mês aberto (livros), sem JE, com ajuste acumulado a fazer
  const open = rows.filter((r) => !closedBooks(r.month) && !booked(r) && (r.catchUp ?? 0) > 0.5);
  const firstOpen = open[0] ?? null;
  const last = rows[rows.length - 1] ?? null;
  const closedRows = rows.filter((r) => closedBooks(r.month));
  const carried = closedRows.length ? closedRows[closedRows.length - 1].catchUp : null; // o que 2025 deixou p/ trás
  const closedShips = cid ? await prisma.inventoryShipment.findMany({ where: { companyId: cid, closedAt: { not: null } }, select: { name: true, key: true, containers: true, isOpening: true, closedData: true, invoices: { where: { kind: "FREIGHT" }, select: { no: true, total: true, date: true } } } }) : [];
  const sysCap = closedShips.reduce((x, sh) => x + ((sh.closedData as unknown as ClosedData | null)?.pool ?? 0), 0);
  const glCap = Object.values(gl?.freightCapitalizedByMonth ?? {}).reduce((x, v) => x + v, 0);
  const billNums = new Set((gl?.vendorBills ?? []).map((b) => b.num));
  const freightNotInGl = closedShips.flatMap((sh) => sh.invoices.filter((i) => !billNums.has(i.no) && gl?.coverageUntil && i.date.getTime() <= gl.coverageUntil.getTime()).map((i) => ({ ship: sh.name ?? sh.key, no: i.no, total: Number(i.total) })));
  const freightGlAccounts = (gl?.vendorBills ?? []).filter((b) => s && b.account !== s.glInventoryAccount && b.account !== s.glFreightAccount && !/Accounts Payable/i.test(b.account));
  const je = (r: (typeof rows)[number]) => {
    const amt = (r.catchUp ?? r.suggested).toFixed(2);
    const delta = r.catchUp == null ? 0 : r.catchUp - r.suggested;
    const extra = delta > 0.5 ? ` · inclui ${delta.toFixed(2)} de meses anteriores` : delta < -0.5 ? ` · já desconta ${(-delta).toFixed(2)} lançado a mais em meses anteriores` : "";
    return `Data: ${r.month}-${new Date(Date.UTC(Number(r.month.slice(0, 4)), Number(r.month.slice(5, 7)), 0)).getUTCDate()}\nDébito   ${s?.glCogsFreightAccount ?? "Shipping and Handling"}${" ".repeat(Math.max(1, 44 - (s?.glCogsFreightAccount.length ?? 21)))}${amt}\nCrédito  ${s?.glFreightAccount ?? "Inventory Asset - Freight & Handling"}${" ".repeat(Math.max(1, 44 - (s?.glFreightAccount.length ?? 36)))}${amt}\nMemo: Adjustment of inventory — frete de importação até ${r.month} (Vixus)${extra}${r.lateAdj ? ` · ${r.lateAdj.toFixed(2)} de frete tardio` : ""}`;
  };

  return (
    <InventoryShell tab="month-end" companies={ctx.companies} companyId={cid} companyName={ctx.company?.legalName ?? null} glUntil={gl?.coverageUntil ?? null}>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi k="Ajuste acumulado a lançar" v={money0(last?.catchUp ?? null)} h={last ? `saldo do GL acima do devido em ${mesBr(last.month)}` : "—"} />
        <Kpi k="Meses com JE pendente" v={open.length} h={open.length ? `desde ${mesBr(open[0].month)}` : "em dia"} />
        <Kpi k="Frete em estoque · deveria" v={money0(last?.shouldFreightStock ?? null)} h={last ? mesBr(last.month) : "—"} />
        <Kpi k="Frete em estoque · GL" v={money0(last?.glFreightStock ?? null)} h={gl?.coverageUntil ? `até ${br(gl.coverageUntil)}` : "—"} />
        <Kpi k="Capitalizado · sistema × GL" v={<span className="text-sm">{money0(sysCap)} × {money0(glCap)}</span>} h={Math.abs(sysCap - glCap) > 1 ? `diferença ${money0(sysCap - glCap)} · ver conferência` : "batem"} />
      </div>

      <div className={card}>
        <h2 className={h2}>Frete a apropriar · mês a mês, com o ajuste acumulado</h2>
        {rows.length === 0 ? <p className="text-sm text-slate-500">Sem camadas nem movimento. Crie a abertura em Settings.</p> : (
          <table className="w-full text-sm">
            <thead><tr><th className={th}>Mês</th><th className={thr}>COGS material (GL)</th><th className={thr}>Frete do mês (FIFO)</th><th className={thr}>Lançado (GL)</th><th className={thr}>Estoque frete · deveria</th><th className={thr}>Estoque frete · GL</th><th className={thr}>Em trânsito no GL</th><th className={thr}>Ajuste acumulado</th><th className={th}>Situação</th><th className={th}></th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const isBooked = booked(r);
                const cb = closedBooks(r.month);
                const settled = Math.abs(r.catchUp ?? 0) <= 0.5;
                const st = cb
                  ? pill("off", "livros fechados")
                  : r.matOut < 0.005 && r.suggested < 0.005 && settled
                    ? pill("off", "sem movimento")
                    : isBooked
                      ? (settled ? pill("ok", r.posted > 0.005 ? "conferido no GL" : "marcado como lançado") : pill("warn", "lançado ≠ devido"))
                      : (r.catchUp ?? 0) > 0.5
                        ? pill("bad", "JE pendente")
                        : (r.catchUp ?? 0) < -0.5
                          ? pill("warn", "GL abaixo do devido")
                          : pill("ok", "em dia");
                return (
                  <tr key={r.month} className="border-t border-slate-100">
                    <td className={`${td} font-semibold`}>{mesBr(r.month)}{r.closing && <span className="block text-[10px] font-normal text-slate-400">fechado · {r.closing.merchEndSource}</span>}</td>
                    <td className={tdr}>{money(r.matOut)}{r.matOut - r.matOutMatched > 0.5 && <span className="block text-[10px] text-red-600">{money(r.matOut - r.matOutMatched)} sem camada</span>}</td>
                    <td className={`${tdr} font-semibold`}>{money(r.suggested)}{r.lateAdj > 0 && <span className="block text-[10px] text-amber-700">inclui tardio {money(r.lateAdj)}</span>}</td>
                    <td className={tdr}>{r.posted > 0.005 ? money(r.posted) : r.closing?.jeBookedAt ? <span className="text-slate-500">{money(r.closing.jeBookedAmount)} (manual)</span> : "—"}</td>
                    <td className={tdr}>{money(r.shouldFreightStock)}</td>
                    <td className={tdr}>{r.glFreightStock == null ? "—" : money(r.glFreightStock)}</td>
                    <td className={`${tdr} text-slate-500`}>{r.openInGl > 0.5 ? money(r.openInGl) : "—"}{r.closedNotInGl > 0.5 && <span className="block text-[10px] text-amber-700">fechado s/ GL {money(r.closedNotInGl)}</span>}</td>
                    <td className={`${tdr} font-semibold ${(r.catchUp ?? 0) > 0.5 ? "text-red-700" : (r.catchUp ?? 0) < -0.5 ? "text-amber-700" : "text-emerald-700"}`}>{r.catchUp == null ? "—" : money(r.catchUp)}</td>
                    <td className={td}>{st}</td>
                    <td className={`${td} text-[11px]`}>
                      {cid && !cb && !r.closing && (r.catchUp ?? 0) > 0.5 && (
                        <ActionForm action={closeMonth} submitLabel="fechar mês" submitClass="rounded border border-[#1f3a5f] px-2 py-0.5 text-[11px] font-semibold text-[#1f3a5f]" className="flex items-center gap-1">
                          <input type="hidden" name="companyId" value={cid} /><input type="hidden" name="month" value={r.month} />
                          {r.glMatStock == null && <input name="merchEnd" placeholder="estoque final $" className="w-28 rounded border border-slate-200 px-1 py-0.5 text-[11px]" />}
                        </ActionForm>
                      )}
                      {cid && r.closing && !r.closing.jeBookedAt && r.posted < 0.005 && (
                        <form action={markJeBooked} className="flex items-center gap-1"><input type="hidden" name="companyId" value={cid} /><input type="hidden" name="month" value={r.month} /><input type="hidden" name="amount" value={r.catchUp ?? r.suggested} /><input type="date" name="date" className="rounded border border-slate-200 px-1 py-0.5 text-[11px]" /><button className="text-[#1f3a5f] hover:underline">marcar lançado</button></form>
                      )}
                      {cid && r.closing?.jeBookedAt && r.posted < 0.005 && <form action={markJeBooked}><input type="hidden" name="companyId" value={cid} /><input type="hidden" name="month" value={r.month} /><input type="hidden" name="undo" value="1" /><button className="text-slate-400 hover:underline">desmarcar</button></form>}
                      {cid && r.closing && <form action={deleteClosing}><input type="hidden" name="companyId" value={cid} /><input type="hidden" name="month" value={r.month} /><button className="text-slate-300 hover:text-red-600">reabrir</button></form>}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t-2 border-slate-200 font-bold"><td className={td}>Total</td><td className={tdr}>{money(rows.reduce((x, r) => x + r.matOut, 0))}</td><td className={tdr}>{money(rows.reduce((x, r) => x + r.suggested, 0))}</td><td className={tdr}>{money(rows.reduce((x, r) => x + r.posted, 0))}</td><td colSpan={6}></td></tr>
            </tbody>
          </table>
        )}
        <p className="mt-2 text-[11px] text-slate-400">
          <b>Ajuste acumulado</b> = saldo da conta de frete no GL − (frete que deveria estar em estoque + frete já no GL de embarques ainda não fechados aqui − frete de embarques fechados que o GL não tem). É o valor da JE que zera o atraso até aquele mês; os meses seguintes voltam a ser só o frete do mês. Frete do mês = FIFO por item com a absorção de cada camada (+ frete que chegou após o fechamento). Meses com livros fechados são só leitura{carried != null && Math.abs(carried) > 0.5 ? `: deixaram ${money(carried)} para o primeiro mês aberto` : ""}. Quando o GL do mês seguinte subir com a JE, a linha confere sozinha.
        </p>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className={card}>
          <h2 className={h2}>{firstOpen ? `JE sugerida · ${mesBr(firstOpen.month)} (primeiro mês aberto sem JE)` : "JE sugerida"}</h2>
          {firstOpen ? (
            <>
              <pre className="whitespace-pre-wrap rounded-lg border border-dashed border-slate-200 bg-slate-50 p-3 text-xs">{je(firstOpen)}</pre>
              <dl className="mt-2 grid grid-cols-[1fr_auto] gap-x-4 gap-y-0.5 text-xs text-slate-600">
                <dt>Saldo da conta de frete no GL em {mesBr(firstOpen.month)}</dt><dd className="text-right tabular-nums">{money(firstOpen.glFreightStock)}</dd>
                <dt>− frete que deveria estar em estoque (camadas)</dt><dd className="text-right tabular-nums">{money(firstOpen.shouldFreightStock)}</dd>
                {firstOpen.openInGl > 0.5 && <><dt>− frete no GL de embarques ainda não fechados aqui</dt><dd className="text-right tabular-nums">{money(firstOpen.openInGl)}</dd></>}
                {firstOpen.closedNotInGl > 0.5 && <><dt>+ frete de embarques fechados que o GL não tem</dt><dd className="text-right tabular-nums">{money(firstOpen.closedNotInGl)}</dd></>}
                <dt className="font-semibold text-slate-800">= JE de ajuste</dt><dd className="text-right font-bold tabular-nums text-[#1f3a5f]">{money(firstOpen.catchUp)}</dd>
                <dt className="text-slate-400">do qual, frete do próprio mês (FIFO)</dt><dd className="text-right tabular-nums text-slate-400">{money(firstOpen.suggested)}</dd>
              </dl>
              <p className="mt-2 text-[11px] text-slate-500">Lance esta JE no QBO com a data do fim do mês, marque “lançado” na linha e suba o GL seguinte. O mês seguinte então mostra só o frete dele.</p>
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
