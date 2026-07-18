import Link from "next/link";
import { cookies } from "next/headers";
import { formatMoney } from "@/lib/money";
import { listInvestorEntities } from "@/lib/pools/investor-portfolio";
import { INV_LANG_COOKIE, langFromCookie, tOf } from "@/lib/pools/i18n";
import { LangToggle } from "@/components/lang-toggle";

export const dynamic = "force-dynamic";

// Fase 4: lista consolidada de entidades investidoras (a porta do "ver como investidor").
// O portal do investidor será a MESMA visão de detalhe, com login mapeando usuário→entidade.
export default async function InvestorsListPage() {
  const lang = langFromCookie((await cookies()).get(INV_LANG_COOKIE)?.value);
  const t = tOf(lang);
  const rows = await listInvestorEntities();

  return (
    <div className="max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <Link href="/pools" className="text-sm text-slate-500 hover:text-slate-700">
            ← Pools
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-slate-800">{t("iv.list.title")}</h1>
          <p className="text-sm text-slate-500">{t("iv.list.desc")}</p>
        </div>
        <div className="ml-auto">
          <LangToggle lang={lang} />
        </div>
      </div>

      <section className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {t("iv.list.investor")}
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {t("iv.list.pools")}
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {t("iv.list.invested")}
              </th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {t("iv.list.units")}
              </th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-slate-50 hover:bg-slate-50/60">
                <td className="px-4 py-2.5 text-sm font-medium text-slate-700">{r.name}</td>
                <td className="px-4 py-2.5 text-right text-sm tabular-nums text-slate-600">{r.pools}</td>
                <td className="px-4 py-2.5 text-right text-sm tabular-nums text-slate-700">
                  {formatMoney(r.invested, "USD")}
                </td>
                <td className="px-4 py-2.5 text-right text-sm tabular-nums text-slate-600">
                  {r.units.toFixed(1)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/pools/investors/${r.key}`}
                    className="text-xs font-semibold text-[#1f3a5f] hover:underline"
                  >
                    {t("iv.list.view")}
                  </Link>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-sm text-slate-400">
                  —
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
