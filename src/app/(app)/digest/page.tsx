import Link from "next/link";
import { buildDigest, type Severity } from "@/lib/digest/build";

export const dynamic = "force-dynamic";

const SEV: Record<Severity, { label: string; dot: string; cls: string }> = {
  alta: { label: "alta", dot: "bg-rose-500", cls: "border-rose-200 bg-rose-50" },
  media: { label: "média", dot: "bg-amber-400", cls: "border-amber-200 bg-amber-50/60" },
  baixa: { label: "baixa", dot: "bg-slate-300", cls: "border-slate-200 bg-white" },
};

export default async function DigestPage({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { year: yParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const wanted = yParam && /^\d{4}$/.test(yParam) ? Number(yParam) : null;

  const probe = await buildDigest(wanted ?? currentYear - 1);
  const years = probe.years.length ? probe.years : [currentYear - 1];
  const year = wanted ?? (years.includes(currentYear - 1) ? currentYear - 1 : years[0]);
  const data = wanted === year ? probe : await buildDigest(year);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Alertas — o que precisa de atenção</h1>
        <p className="max-w-3xl text-sm text-slate-500">
          Tudo que o app achou que pede ação, num lugar só: divergências vs IR, IR faltando, estadual sem
          cadastro, obrigações a vencer. É o conteúdo do <strong>digest semanal</strong> (a entrega por
          e-mail é o próximo passo).
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Ano:</span>
        {years.map((y) => (
          <Link key={y} href={`/digest?year=${y}`} className={`rounded-full px-3 py-1 ${y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{y}</Link>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4">
          <div className="text-2xl font-semibold tabular-nums text-rose-700">{data.counts.alta}</div>
          <div className="text-xs text-rose-700">alta prioridade</div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="text-2xl font-semibold tabular-nums text-amber-700">{data.counts.media}</div>
          <div className="text-xs text-amber-700">média</div>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4">
          <div className="text-2xl font-semibold tabular-nums text-slate-700">{data.alerts.length}</div>
          <div className="text-xs text-slate-500">total</div>
        </div>
      </div>

      {data.alerts.length === 0 ? (
        <div className="rounded-xl border border-[#8DC63F]/50 bg-[#8DC63F]/10 p-6 text-sm text-[#3B6D11]">
          ✓ Nada pendente em {year}. Tudo que o app confere está em ordem.
        </div>
      ) : (
        <div className="space-y-2">
          {data.alerts.map((a, i) => (
            <Link key={i} href={a.href} className={`flex items-start gap-3 rounded-xl border px-4 py-3 hover:brightness-[0.98] ${SEV[a.severity].cls}`}>
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV[a.severity].dot}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-wide text-slate-400">{a.category}</span>
                </div>
                <div className="font-medium text-slate-800">{a.title}</div>
                <div className="text-[13px] text-slate-600">{a.detail}</div>
              </div>
              <span className="mt-1 shrink-0 text-slate-300">›</span>
            </Link>
          ))}
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Próximo passo (infra): entregar isto por e-mail semanal automático — quando o QBO manda os relatórios,
        o app importa, reconcilia e manda este resumo. Requer definir o serviço de e-mail + cron.
      </p>
    </div>
  );
}
