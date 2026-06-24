import Link from "next/link";
import { buildClosingSequence, type SeqNode } from "@/lib/closing/sequence";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; cls: string }> = {
  done: { label: "fechado", cls: "bg-green-50 text-green-700" },
  ready: { label: "pronta p/ fechar", cls: "bg-sky-50 text-sky-700" },
  blocked: { label: "aguardando", cls: "bg-slate-100 text-slate-500" },
};

export default async function ClosingSequencePage({
  searchParams,
}: {
  searchParams: Promise<{ year?: string }>;
}) {
  const { year: yParam } = await searchParams;
  const currentYear = new Date().getUTCFullYear();
  const wanted = yParam && /^\d{4}$/.test(yParam) ? Number(yParam) : null;

  const probe = await buildClosingSequence(wanted ?? currentYear - 1);
  const years = probe.years.length ? probe.years : [currentYear - 1];
  const year = wanted ?? (years.includes(currentYear - 1) ? currentYear - 1 : years[0]);
  const seq = wanted === year ? probe : await buildClosingSequence(year);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Closing sequence</h1>
        <p className="text-sm text-slate-500">
          A ordem de fechar o IR seguindo a árvore pass-through: cada entidade só fecha depois das
          investidas que lhe emitem K-1. Feche de cima para baixo (passo 1 → último). Pagador final
          (final) = C-corp ou PF.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 text-sm">
        <span className="mr-1 text-slate-400">Ano:</span>
        {years.map((y) => (
          <Link
            key={y}
            href={`/closing-sequence?year=${y}`}
            className={`rounded-full px-3 py-1 ${y === year ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {y}
          </Link>
        ))}
      </div>

      {seq.outOfOrder.length > 0 && (
        <div className="space-y-2 rounded-xl border border-red-200 bg-red-50/60 p-4">
          <div className="text-sm font-medium text-red-800">
            ⚠ Fechou fora de ordem ({seq.outOfOrder.length}) — confira se o K-1 entrou
          </div>
          {seq.outOfOrder.map((n) => (
            <div key={n.key} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-sm">
              <span className="font-medium text-slate-800">{n.name}</span>
              <span className="text-slate-500"> fechou, mas estas investidas ainda estão abertas: </span>
              <span className="font-medium text-red-700">{n.outOfOrder.join(", ")}</span>
            </div>
          ))}
        </div>
      )}

      {seq.nextUp.length > 0 && (
        <div className="rounded-xl border border-sky-200 bg-sky-50/60 px-4 py-3 text-sm text-sky-800">
          <span className="font-medium">Próximas a fechar agora:</span>{" "}
          {seq.nextUp.map((n) => n.name).join(", ")}
        </div>
      )}

      <div className="space-y-3">
        {seq.tiers.map((tier, i) => (
          <div key={i} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-600">
              Passo {i + 1}
            </div>
            <div className="divide-y divide-slate-100">
              {tier.map((n) => (
                <Row key={n.key} n={n} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-xs text-slate-400">
        Dependência vem dos K-1 declarados no IR (autêntico) e, como fallback, da posse de
        pass-through no cadastro de ownership. ✓ = investida já fechada. Trave o ano em cada empresa
        para marcar como fechado.
      </p>
    </div>
  );
}

function Row({ n }: { n: SeqNode }) {
  const st = STATUS[n.status];
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
      <div className="min-w-0">
        <span className="font-medium text-slate-800">
          {n.kind === "company" ? (
            <Link href={`/companies/${n.id}`} className="hover:underline">
              {n.name}
            </Link>
          ) : (
            n.name
          )}
        </span>
        {n.finalPayer && (
          <span className="ml-2 rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">
            {n.kind === "person" ? "1040" : "C-corp"} · final
          </span>
        )}
        {n.deps.length > 0 && (
          <span className="block text-xs text-slate-400">
            ← depende de{" "}
            {n.deps.map((d, k) => (
              <span key={d.key} className={d.done ? "text-emerald-600" : "text-slate-400"}>
                {k > 0 && ", "}
                {d.name}
                {d.done ? " ✓" : ""}
              </span>
            ))}
          </span>
        )}
        {n.inCycle && (
          <span className="block text-xs text-amber-600">⚠ posse circular — revisar o cadastro</span>
        )}
      </div>
      <span className={`rounded-full px-2 py-0.5 text-xs whitespace-nowrap ${st.cls}`}>{st.label}</span>
    </div>
  );
}
