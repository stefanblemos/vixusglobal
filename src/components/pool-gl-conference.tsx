import Link from "next/link";
import { importGlTxnToHouse } from "@/lib/actions/pools";
import { CASH_CATEGORIES } from "@/lib/pools/house-cash";
import type { HouseGlReport, LoanGlReport } from "@/lib/pools/gl-match";

// Conferência com o GL do QuickBooks (etapa 3): por casa, o que o GL tem e o extrato não,
// com "trazer p/ o extrato" (data real; abertura com o mesmo valor é só datada). Pelo loan,
// os totais da conta do GL × aba Banco. Server-rendered (forms próprias).

const f2 = (v: number) => v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const br = (iso: string) => iso.split("-").reverse().join("/");
const COST_CATS = CASH_CATEGORIES.filter(([v]) => v !== "EQUITY_IN" && v !== "RETURN_TO_POOL");

export function PoolGlConference({
  poolId,
  companyName,
  hasGl,
  glCount,
  houses,
  loans,
  currency,
}: {
  poolId: string;
  companyName: string | null;
  hasGl: boolean;
  glCount: number;
  houses: HouseGlReport[];
  loans: LoanGlReport[];
  currency: string;
}) {
  const totalSugg = houses.reduce((s, h) => s + h.suggestions.length, 0);
  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Conferência com o QuickBooks</h2>
        <p className="mt-0.5 text-xs text-slate-400">
          {companyName
            ? `Os livros do pool vivem no GL de ${companyName}${hasGl ? ` (${glCount.toLocaleString("en-US")} transações importadas)` : ""}. A conferência é por recorte: transações que citam o endereço da casa e a conta do loan.`
            : "Pool sem entidade vinculada — ligue a empresa em Edit pool para conferir com o GL."}
        </p>
      </div>
      {!hasGl ? (
        <div className="px-5 py-5 text-xs text-slate-400">
          Sem General Ledger importado para essa entidade. Suba o GL em{" "}
          <Link href="/import" className="underline">Documents</Link> e volte aqui.
        </div>
      ) : (
        <div className="divide-y divide-slate-100">
          {loans.length > 0 && (
            <div className="px-5 py-3 text-[12.5px]">
              {loans.map((l) => (
                <div key={l.loanNumber} className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-slate-700">
                    Conta do loan <b>{l.loanNumber}</b> no GL: {l.glCount} lançamentos ·{" "}
                    <b className="tabular-nums">{currency} {f2(l.glTotal)}</b>
                  </span>
                  <span className="text-slate-500">
                    aba Banco (entradas): {l.bankCount} · <b className="tabular-nums">{currency} {f2(l.bankTotal)}</b>{" "}
                    <Link href={`/pools/${poolId}/loan`} className="underline hover:text-slate-700">ver →</Link>
                  </span>
                </div>
              ))}
              <p className="mt-1 text-[11px] text-slate-400">
                Os dois lados somam coisas diferentes (o GL registra o que a VAI contabilizou; a aba Banco, o
                statement do banco) — a comparação é de ordem de grandeza, não centavo a centavo.
              </p>
            </div>
          )}
          <div className="px-5 py-3">
            <div className="flex items-baseline justify-between">
              <span className="text-[12.5px] font-semibold text-slate-700">Por casa — no GL e ainda não no extrato</span>
              <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-semibold ${totalSugg ? "bg-amber-100 text-amber-800" : "bg-emerald-50 text-emerald-700"}`}>
                {totalSugg ? `${totalSugg} a trazer` : "nada pendente"}
              </span>
            </div>
            {houses.filter((h) => h.suggestions.length > 0).map((h) => (
              <div key={h.houseId} className="mt-3">
                <Link href={`/pools/${poolId}/houses/${h.houseId}`} className="text-[12.5px] font-semibold text-[#1f3a5f] hover:underline">{h.address}</Link>
                <table className="mt-1 w-full">
                  <tbody className="text-[12px]">
                    {h.suggestions.map((s) => (
                      <tr key={s.txnId} className="border-b border-slate-50">
                        <td className="whitespace-nowrap py-1.5 pr-2 text-slate-500">{br(s.date)}</td>
                        <td className="py-1.5 pr-2 text-slate-700">
                          <span className="text-slate-400">{s.account} · </span>{[s.name, s.description].filter(Boolean).join(" · ")}
                          {s.matchesOpening ? (
                            <span className="ml-1 rounded-full bg-emerald-50 px-1.5 text-[10px] font-semibold text-emerald-700">mesmo valor da abertura → reconcilia (só data)</span>
                          ) : s.suggestedEntryId ? (
                            <span className="ml-1 rounded-full bg-blue-50 px-1.5 text-[10px] font-semibold text-[#1f3a5f]">comprova a abertura (valor fica, data entra)</span>
                          ) : (
                            <span className="ml-1 rounded-full bg-amber-50 px-1.5 text-[10px] font-semibold text-amber-800">sem par → somar aumenta o custo em ${f2(s.amount)}</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-2 text-right tabular-nums">{f2(s.amount)}</td>
                        <td className="py-1.5 text-right">
                          {/* reconciliar (padrão quando há par/abertura) × somar como custo novo */}
                          <form action={importGlTxnToHouse} className="flex items-center justify-end gap-1.5">
                            <input type="hidden" name="houseId" value={h.houseId} />
                            <input type="hidden" name="txnId" value={s.txnId} />
                            <select name="target" defaultValue={s.suggestedEntryId ? `rec:${s.suggestedEntryId}` : "add"} className="max-w-[260px] rounded border border-slate-300 px-1.5 py-0.5 text-[11px]">
                              {s.candidates.map((c) => (
                                <option key={c.id} value={`rec:${c.id}`}>reconciliar com {c.label}{c.sameAmount ? " ✓" : ""}</option>
                              ))}
                              <option value="add">somar como custo novo (+${f2(s.amount)})</option>
                            </select>
                            <select name="category" defaultValue={s.category} title="categoria (só se somar)" className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px]">
                              {COST_CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                            </select>
                            <button type="submit" className="rounded bg-[#1f3a5f] px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-[#16304f]">
                              aplicar
                            </button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
            {totalSugg === 0 && (
              <p className="mt-1 text-[11px] text-slate-400">
                Nenhuma transação do GL cita um endereço de casa sem par no extrato. Contas genéricas (Purchase Lot,
                Contractors, Closing Costs) misturam projetos — para separar, use class/projeto no QBO ou cite o endereço na descrição.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
