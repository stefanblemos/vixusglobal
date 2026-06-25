import Link from "next/link";
import { buildTaxPreview, type EntityType } from "@/lib/tax/preview";
import { formatMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const TYPE_TAG: Record<EntityType, string> = {
  "C-corp": "bg-sky-50 text-sky-700",
  "Pass-through": "bg-green-50 text-green-700",
  PF: "bg-amber-50 text-amber-700",
};

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

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-2 font-medium">Entidade</th>
              <th className="px-3 py-2 text-right font-medium">Lucro líq.</th>
              <th className="px-3 py-2 text-right font-medium">+ Não ded.</th>
              <th className="px-3 py-2 text-right font-medium">± Deprec.</th>
              <th className="px-3 py-2 text-right font-medium">+ K-1</th>
              <th className="px-3 py-2 text-right font-medium">= Base trib.</th>
              <th className="px-3 py-2 text-right font-medium">IR estimado</th>
              <th className="px-3 py-2 font-medium">Fluxo</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {data.rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-4 text-sm text-slate-400">
                  Nenhuma entidade no escopo. Verifique empresas/pessoas marcadas no fechamento.
                </td>
              </tr>
            ) : (
              data.rows.map((r) => (
                <tr key={r.key} className={r.taxable < 0 ? "bg-red-50/30" : ""}>
                  <td className="px-4 py-2">
                    <div className="font-medium text-slate-800">{r.name}</div>
                    <span className={`rounded-full px-1.5 py-0.5 text-[11px] ${TYPE_TAG[r.entityType]}`}>{r.entityType}</span>
                    {!r.hasPnl && r.kind === "company" && <span className="ml-1 text-[10px] text-amber-600">sem P&L</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.kind === "person" ? "—" : m(r.bookNet)}</td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.nonDeductible ? m(r.nonDeductible) : "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.depAdj < 0 ? "text-emerald-600" : "text-slate-600"}`}>
                    {r.depAdj ? m(r.depAdj) : "—"}
                    {r.kind === "company" && r.hasPnl && !r.depFromMacrs && (
                      <div className="text-[10px] text-amber-600">livro (cadastre ativos p/ MACRS)</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{r.k1In ? m(r.k1In) : "—"}</td>
                  <td className={`px-3 py-2 text-right tabular-nums font-medium ${r.taxable < 0 ? "text-red-600" : "text-slate-800"}`}>{m(r.taxable)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {r.entityType === "Pass-through" ? (
                      <span className="text-slate-400">— (repassa)</span>
                    ) : (
                      <span className="font-semibold text-slate-900">{m(r.tax)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500">
                    {r.entityType === "Pass-through"
                      ? r.passesTo.length
                        ? `repassa: ${r.passesTo.map((p) => `${p.acronym} ${p.pct.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`).join(" · ")}`
                        : "repassa aos sócios"
                      : r.entityType === "PF"
                        ? "pagador final (1040)"
                        : "paga 21%"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-slate-400">
        Não dedutíveis detectados do P&L: 50% de refeições, multas/penalidades, seguro de vida,
        imposto federal, contribuições políticas/clube. Depreciação: a do livro (P&L) é{" "}
        <strong>substituída</strong> pela MACRS (ajuste = livro − MACRS, conta uma vez só) —{" "}
        <strong>apenas se a empresa tiver ativos cadastrados</strong>; sem cadastro, mantém a do livro
        e marca &ldquo;livro&rdquo; (cadastre os ativos para conferir). K-1 repassa a base tributável
        das pass-through pela % de participação (árvore de ownership). PF: faixas federais MFJ 2024
        com dedução padrão, só federal, sem créditos — teto aproximado. Confirme com o contador
        (estado, créditos, limites, Form 3115).
      </p>
    </div>
  );
}
