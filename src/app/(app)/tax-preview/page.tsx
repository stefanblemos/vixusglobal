import Link from "next/link";
import { buildTaxPreview } from "@/lib/tax/preview";
import { TaxPreviewTable } from "@/components/tax-preview-detail";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const m = (n: number) => formatMoney(n, "USD");

export default async function TaxPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const wanted = yParam && /^\d{4}$/.test(yParam) ? Number(yParam) : null;

  const probe = await buildTaxPreview(wanted ?? currentYear - 1);
  const years = probe.years.length ? probe.years : [currentYear - 1];
  const year = wanted ?? (years.includes(currentYear - 1) ? currentYear - 1 : years[0]);
  const data = wanted === year ? probe : await buildTaxPreview(year);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Tax preview</h1>
        <p className="text-sm text-slate-500">
          IR estimado por entidade a partir do QBO: lucro líquido + despesas não dedutíveis ± ajuste
          de depreciação (livro → MACRS) + K-1 recebido = base tributável → imposto. C-corp 21%
          federal; pass-through repassa via K-1; PF nas faixas federais (MFJ 2024, só federal).
          Estimativa de controle — confirme com o contador.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Ano:</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/tax-preview?year=${y}`}
            className={`rounded-full px-3 py-1 ${y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {y}
          </Link>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border-2 border-[#8DC63F]/60 bg-[#8DC63F]/[0.08] p-4">
          <div className="text-xs text-slate-600">IR estimado do grupo ({year})</div>
          <div className="mt-1 text-2xl font-semibold tabular-nums text-[#3B6D11]">{m(data.groupTax)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">IR de C-corps (21%)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{m(data.corpTax)}</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-xs text-slate-500">IR de pessoas físicas (1040)</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-slate-800">{m(data.pfTax)}</div>
        </div>
      </div>

      {data.missingPnl.length > 0 && (
        <p className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-2 text-xs text-amber-800">
          Sem P&L de {year} importado para: {data.missingPnl.join(", ")} — essas entidades entram com
          lucro $0. Importe o P&L para o cálculo ficar completo.
        </p>
      )}

      {data.excludedNonUsd.length > 0 && (
        <p className="rounded-lg border border-slate-300 bg-slate-50 px-4 py-2 text-xs text-slate-600">
          Fora deste cálculo (imposto federal US, só USD): {data.excludedNonUsd.join(", ")} — entidades
          em moeda estrangeira são tributadas no próprio país (PT/BR), não a 21% federal.
        </p>
      )}

      <TaxPreviewTable rows={data.rows} year={year} />

      <p className="text-xs text-slate-400">
        Não dedutíveis detectados do P&L: 50% de refeições, multas/penalidades, seguro de vida,
        imposto federal, contribuições políticas/clube. Imposto estadual: o add-back do ano vem do
        controle em <strong>Florida → Apuração</strong> (principal + multa do que foi pago no ano;
        os juros são dedutíveis p/ C-corp e ficam de fora). Depreciação: a base{" "}
        <strong>confia no livro</strong> (P&L) — a depreciação já aplicada permanece, sem recálculo;
        quando livro e MACRS divergem, isso vira só uma <strong>flag</strong> com o catch-up acumulado
        (ver Conferência), não imposto. A MACRS do app só entra na base quando o livro{" "}
        <strong>não tem</strong> depreciação no ano (preenche a lacuna como dedução). K-1 repassa a base tributável
        das pass-through pela % de participação (árvore de ownership). PF: faixas federais MFJ 2024
        com dedução padrão, só federal, sem créditos — teto aproximado. Confirme com o contador
        (estado, créditos, limites, Form 3115).
      </p>
    </div>
  );
}
