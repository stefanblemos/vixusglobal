import Link from "next/link";
import { coaBySection, type M1Concept } from "@/lib/coa/canonical";

export const dynamic = "force-dynamic";

const M1_LABEL: Record<M1Concept, string> = {
  federal_tax: "IR federal — não dedutível (add-back)",
  state_principal: "estadual principal — dedutível fed / add-back FL",
  state_penalty: "multa estadual — não dedutível",
  state_interest: "juros estadual — dedutível",
  meals_50: "50% dedutível",
  entertainment: "100% não dedutível",
  penalties: "não dedutível",
  officer_life: "não dedutível",
  political: "não dedutível",
};

export default function CoaPage() {
  const sections = coaBySection();
  const total = sections.reduce((s, g) => s + g.accounts.length, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Plano de contas canônico</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            O <strong>mesmo</strong> plano de contas para <strong>todas</strong> as empresas. Se o QBO de
            cada uma usar exatamente estas contas, o app lê sem adivinhar, o add-back fica exato, e a
            consolidação do grupo vira soma limpa. A separação-chave: o estadual em{" "}
            <strong>principal / multa / juros</strong> (contas diferentes) — fim do balde único.
          </p>
        </div>
        <a
          href="/api/export/coa"
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm text-white hover:bg-[#16304f]"
        >
          ↓ Baixar para importar no QBO (CSV)
        </a>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-600">
        <div className="font-medium text-slate-700">Como usar</div>
        <ol className="mt-1 list-decimal space-y-0.5 pl-4">
          <li>Baixe o CSV e importe no QBO da empresa (Configurações → Importar dados → Plano de contas).</li>
          <li>Faça o mesmo em <strong>cada</strong> empresa — todas ficam idênticas.</li>
          <li>Lance seguindo os <strong><Link href="/coa/guides" className="text-sky-700 underline hover:text-sky-900">guias de lançamento</Link></strong> (ex.: estadual em 3 contas). O app passa a ler e colocar cada valor no lugar certo automaticamente.</li>
        </ol>
      </div>

      {sections.map((g) => (
        <div key={g.section} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700">
            {g.section} <span className="text-slate-400">({g.accounts.length})</span>
          </div>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-50">
              {g.accounts.map((a) => (
                <tr key={a.code} className={a.m1 ? "bg-amber-50/40" : ""}>
                  <td className="w-14 py-1.5 pl-4 font-mono text-xs text-slate-400">{a.code}</td>
                  <td className="py-1.5 font-medium text-slate-800">
                    {a.name}
                    {a.intercompany && <span className="ml-2 rounded-full bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">intercompany</span>}
                    {a.note && <div className="text-[11px] font-normal text-slate-400">{a.note}</div>}
                  </td>
                  <td className="py-1.5 pr-2 text-right text-[11px] text-slate-400">
                    {a.qboType}
                  </td>
                  <td className="w-64 py-1.5 pr-4 text-right">
                    {a.m1 && (
                      <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">{M1_LABEL[a.m1]}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <p className="text-[11px] text-slate-400">
        {total} contas. As linhas <span className="rounded bg-amber-50 px-1">âmbar</span> têm tratamento
        fiscal especial (M-1) — usar a conta certa faz o add-back sair exato, sem regex nem interpretação.
        Contas &ldquo;intercompany&rdquo; são eliminadas na consolidação do grupo. Este é o padrão v1;
        conforme surgirem contas novas, acrescentamos aqui (fonte única).
      </p>
    </div>
  );
}
