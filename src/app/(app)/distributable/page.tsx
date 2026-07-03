import Link from "next/link";
import { buildDistributableReport } from "@/lib/tax/distributable";
import { reserveYears } from "@/lib/tax/reserve";
import { YearSelect } from "@/components/year-select";
import { DistributableReport } from "@/components/distributable-report";

export const dynamic = "force-dynamic";

export default async function DistributablePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yearRaw } = await searchParams;
  const years = await reserveYears();
  const fallback = years[0] ?? new Date().getFullYear();
  const year = yearRaw && years.includes(Number(yearRaw)) ? Number(yearRaw) : fallback;
  const report = await buildDistributableReport(year);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Base distribuível — renda já tributada</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            Quanto dá para transferir de cada pass-through ao <strong>destino final</strong> (pessoa ou
            C-corp) <strong>sem pagar imposto de novo</strong> — a renda já foi tributada no K-1. A base
            é a <strong>capital account (fim)</strong> do último IR (fonte: a declaração, não os livros).
            Valor <strong>bruto</strong>: distribuir até a base é devolução de renda já tributada
            (tax-free); acima dela vira ganho de capital.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {years.length > 0 && <YearSelect years={years} value={year} basePath="/distributable" />}
          <a
            href={`/api/export/distributable?year=${year}`}
            className="rounded-lg border border-slate-200 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
          >
            ↓ Exportar CSV
          </a>
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-600">
        <div className="font-medium text-slate-700">Lançamento contábil da transferência</div>
        <ul className="mt-1 space-y-0.5">
          <li>
            <strong>Origem</strong> (a pass-through): <span className="font-mono">D Distributions / Owner&apos;s equity</span> ·{" "}
            <span className="font-mono">C Caixa</span> — reduz a capital account (não é despesa).
          </li>
          <li>
            <strong>Destino C-corp</strong> (QBO): <span className="font-mono">D Caixa</span> ·{" "}
            <span className="font-mono">C Investment in [origem]</span> — return of capital (não é receita).
          </li>
          <li>
            <strong>Destino pessoa</strong>: distribuição ao sócio — na PF é devolução de base, não renda.
          </li>
        </ul>
      </div>

      {report.owners.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          Nada a distribuir com base no IR de {year}. Veja abaixo o que falta.
        </div>
      ) : (
        <DistributableReport owners={report.owners} />
      )}

      {report.missing.length > 0 && (
        <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          <div className="font-medium">⚠ Pass-throughs não calculadas — falta dado do IR (não chuto, para não vir errado)</div>
          <ul className="mt-1 space-y-0.5">
            {report.missing.map((m) => (
              <li key={m.companyId}>
                <Link href={`/companies/${m.companyId}`} className="underline hover:text-amber-900">{m.name}</Link> —{" "}
                {m.reason === "sem-ir" ? (
                  <span>sem IR até {year} no app — <Link href="/tax" className="underline">subir o IR</Link></span>
                ) : (
                  <span>IR presente, mas sem a figura &ldquo;capital account (end)&rdquo; — conferir/re-extrair a declaração</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-[11px] text-slate-400">
        Base = capital account (fim) do IR = aporte + renda já tributada − distribuições. Teto: acima da
        base, o excedente vira ganho de capital. Cadeia: pass-through → dono; C-corp e pessoa são destino
        final (a base das investidas de uma pass-through já está na capital account dela — sem dupla
        contagem). Confirme com o contador antes de distribuir.
      </p>
    </div>
  );
}
