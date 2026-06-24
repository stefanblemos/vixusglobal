import Link from "next/link";
import { buildOrgChart } from "@/lib/org/chart";
import { OrgChartSvg } from "./org-chart-svg";

export const dynamic = "force-dynamic";

export default async function OrgChartPage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const wanted = yParam && /^\d{4}$/.test(yParam) ? Number(yParam) : null;

  const probe = await buildOrgChart(wanted ?? currentYear - 1);
  const years = probe.years.length ? probe.years : [currentYear - 1];
  const year = wanted ?? (years.includes(currentYear - 1) ? currentYear - 1 : years[0]);
  const chart = wanted === year ? probe : await buildOrgChart(year);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Organograma</h1>
        <p className="text-sm text-slate-500">
          Estrutura de donos × investidas (pass-through) com os percentuais, vigente no ano
          escolhido. Donos finais (PF/holdings de topo) ficam em cima; a renda flui de baixo para
          cima (via K-1). Trocar dono no cadastro para um ano se reflete aqui.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Ano:</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/org-chart?year=${y}`}
            className={`rounded-full px-3 py-1 ${y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {y}
          </Link>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded bg-[#1f3a5f]" /> Pessoa (PF · 1040)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border border-slate-300 bg-white" /> Empresa pass-through
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-3 w-3 rounded border-2 border-amber-500 bg-white" /> C-corp (paga no nível)
        </span>
        <span className="text-slate-400">% na linha = participação do dono na investida.</span>
        <span className="text-slate-400">Passe o mouse numa caixa para destacar a linhagem.</span>
      </div>

      {chart.nodes.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Nenhuma participação cadastrada vigente em {year}. Cadastre em{" "}
          <Link href="/parties" className="text-[#1f3a5f] hover:underline">
            Owners / Ownership
          </Link>
          .
        </div>
      ) : (
        <div className="overflow-auto rounded-xl border border-slate-200 bg-white p-2">
          <OrgChartSvg
            nodes={chart.nodes}
            edges={chart.edges}
            width={chart.width}
            height={chart.height}
          />
        </div>
      )}

      <p className="text-xs text-slate-400">
        Dados do cadastro de Ownership (vigência por data). Se a soma dos donos de uma entidade for
        menor que 100%, falta cadastrar participação — aparece em cinza no rótulo &ldquo;donos:
        x%&rdquo;.
      </p>
    </div>
  );
}
