import Link from "next/link";
import { buildM1Bridge } from "@/lib/tax/m1-bridge";

export const dynamic = "force-dynamic";

const M = (n: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const FIG: Record<string, string> = { TAXABLE_INCOME: "taxable income", ORDINARY_INCOME: "ordinary income", NET_INCOME: "lucro por livro" };

export default async function M1BridgePage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: yParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const wanted = yParam && /^\d{4}$/.test(yParam) ? Number(yParam) : null;

  const probe = await buildM1Bridge(wanted ?? currentYear - 1);
  const years = probe.years.length ? probe.years : [currentYear - 1];
  const year = wanted ?? (years.includes(currentYear - 1) ? currentYear - 1 : years[0]);
  const data = wanted === year ? probe : await buildM1Bridge(year);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Ponte M-1 (livro → imposto)</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Do <strong>lucro por livro</strong> (QBO) até a <strong>base tributável</strong>, nas linhas reais do
          Schedule M-1 — cada ajuste rastreado. A última linha é comparada com o IR declarado. Entregue ao
          contador e confira linha a linha.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Ano:</span>
        {years.map((y) => (
          <Link key={y} href={`/m1-bridge?year=${y}`} className={`rounded-full px-3 py-1 ${y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{y}</Link>
        ))}
      </div>

      <div className="space-y-2">
        {data.entities.map((e) => (
          <details key={e.companyId} className="group overflow-hidden rounded-xl border border-slate-200 bg-white" open={e.matches === false}>
            <summary className="flex cursor-pointer items-center justify-between gap-3 px-4 py-2.5 hover:bg-slate-50">
              <div className="flex items-center gap-2">
                <span className="text-slate-400 transition group-open:rotate-90">›</span>
                <span className="font-medium text-slate-800">{e.name}</span>
                <span className="rounded-full bg-slate-50 px-1.5 py-0.5 text-[10px] text-slate-500">{e.entityType}</span>
              </div>
              <div className="flex items-center gap-2 text-[11px]">
                <span className="tabular-nums text-slate-500">base {M(e.taxable)}</span>
                {e.matches === true && <span className="rounded-full bg-[#8DC63F]/20 px-2 py-0.5 text-[#3B6D11]">confere com IR</span>}
                {e.matches === false && <span className="rounded-full bg-rose-100 px-2 py-0.5 text-rose-700">diverge {e.diff != null ? M(e.diff) : ""}</span>}
                {e.matches == null && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-500">sem IR</span>}
              </div>
            </summary>
            <div className="border-t border-slate-100 px-4 py-3">
              <table className="w-full text-sm">
                <tbody>
                  {e.lines.map((l, i) => (
                    <tr key={i} className={l.code === "10" ? "border-t-2 border-slate-200 font-semibold" : ""}>
                      <td className="w-10 py-1.5 font-mono text-[11px] text-slate-400">M-1.{l.code}</td>
                      <td className="py-1.5">
                        <span className="text-slate-700">{l.label}</span>
                        {l.detail && <div className="text-[11px] text-slate-400">{l.detail}</div>}
                      </td>
                      <td className={`py-1.5 text-right tabular-nums ${l.sign === "−" ? "text-emerald-600" : l.code === "10" ? "text-slate-900" : "text-slate-700"}`}>
                        {l.sign === "−" ? "(" : ""}{M(l.amount)}{l.sign === "−" ? ")" : ""}
                      </td>
                    </tr>
                  ))}
                  {e.irTaxable != null && (
                    <tr className="text-slate-500">
                      <td></td>
                      <td className="py-1.5 text-[12px]">IR declarado ({FIG[e.irKey ?? ""] ?? e.irKey})</td>
                      <td className="py-1.5 text-right tabular-nums text-[12px]">{M(e.irTaxable)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
              {e.matches === false && (
                <p className="mt-2 rounded-md border border-rose-200 bg-rose-50 px-2 py-1 text-[11px] text-rose-800">
                  A base computada diverge do IR em {e.diff != null ? M(Math.abs(e.diff)) : ""} — conferir na{" "}
                  <Link href={`/tax-audit?year=${year}`} className="underline">Conferência IR</Link> e na{" "}
                  <Link href={`/companies/${e.companyId}/year/${year}`} className="underline">empresa</Link>.
                </p>
              )}
            </div>
          </details>
        ))}
      </div>

      <p className="text-[11px] text-slate-400">
        Reconstrução de controle a partir do QBO — as linhas do M-1 real do contador podem diferir (classificação,
        itens não capturados). O objetivo é a <strong>ponte auditável</strong>: cada dólar do lucro por livro até a
        base tributável, para bater com a declaração. Confirmar com o contador.
      </p>
    </div>
  );
}
