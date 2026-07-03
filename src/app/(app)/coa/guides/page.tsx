import Link from "next/link";
import { POSTING_GUIDES } from "@/lib/coa/guides";

export const dynamic = "force-dynamic";

export default function PostingGuidesPage() {
  return (
    <div className="space-y-6">
      <div>
        <Link href="/coa" className="text-xs text-sky-700 hover:underline">← Plano de contas</Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Guias de lançamento</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Como lançar cada operação no QBO usando o plano canônico — para o app ler certo e o cálculo
          do imposto sair exato, sem interpretação do contador nem do sistema. Cada guia mostra o{" "}
          <span className="rounded bg-emerald-50 px-1 text-emerald-700">débito</span> /{" "}
          <span className="rounded bg-sky-50 px-1 text-sky-700">crédito</span> e o erro comum que evita.
        </p>
      </div>

      <div className="space-y-4">
        {POSTING_GUIDES.map((g) => (
          <section key={g.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5">
              <div className="font-medium text-slate-800">{g.title}</div>
              <div className="text-xs text-slate-500">{g.when}</div>
            </div>
            <div className="px-4 py-3">
              <table className="w-full text-sm">
                <tbody>
                  {g.lines.map((l, i) => (
                    <tr key={i}>
                      <td className="w-8 py-1">
                        <span className={`inline-flex h-5 w-5 items-center justify-center rounded text-xs font-semibold ${l.side === "D" ? "bg-emerald-100 text-emerald-700" : "bg-sky-100 text-sky-700"}`}>
                          {l.side}
                        </span>
                      </td>
                      <td className="w-14 py-1 font-mono text-xs text-slate-400">{l.code}</td>
                      <td className="py-1 font-medium text-slate-800">{l.name}</td>
                      <td className="py-1 pl-3 text-[11px] text-slate-500">{l.hint}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {g.wrong && (
                <div className="mt-3 rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-800">
                  <span className="font-medium">✗ Erro comum:</span> {g.wrong}
                </div>
              )}
              {g.note && <p className="mt-2 text-[11px] text-slate-500">{g.note}</p>}
            </div>
          </section>
        ))}
      </div>

      <p className="text-[11px] text-slate-400">
        Convenção contábil: <strong>D</strong> (débito) aumenta ativo/despesa; <strong>C</strong> (crédito)
        aumenta passivo/patrimônio/receita. Na dúvida, confirme com o contador — estes guias existem para
        alinhar todos no mesmo padrão.
      </p>
    </div>
  );
}
