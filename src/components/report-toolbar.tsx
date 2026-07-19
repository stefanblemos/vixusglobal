"use client";

import { useActionState, useState, useTransition } from "react";
import { generateReportNarrative, publishMonthlyReport, type FormState } from "@/lib/actions/pool-docs";
import type { Lang } from "@/lib/pools/i18n";
import type { PreflightResult } from "@/lib/pools/preflight";

// Barra do report mensal (Fase 5): imprimir + publicar com narrativa editável.
// A barra é da PLATAFORMA (admin) — some na impressão (print:hidden no wrapper).

export function PrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
    >
      {label}
    </button>
  );
}

export function PublishReportForm({
  poolId,
  month,
  defaultNarrative,
  defaultMarket = "",
  publishLabel,
  narrativeLabel,
  marketLabel,
  lang,
  preflight,
}: {
  poolId: string;
  month: string;
  defaultNarrative: string;
  defaultMarket?: string;
  publishLabel: string;
  narrativeLabel: string;
  marketLabel: string;
  lang: Lang;
  preflight: PreflightResult;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    publishMonthlyReport.bind(null, poolId, month),
    undefined,
  );
  // prosa IA: gera narrativa + comentário de mercado p/ revisão — publicar continua manual
  const [narrative, setNarrative] = useState(defaultNarrative);
  const [market, setMarket] = useState(defaultMarket);
  const [force, setForce] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPending, startAi] = useTransition();
  const tx = lang === "pt"
    ? { title: "Fechamento do mês", allGood: "✓ Tudo certo para publicar.", blockers: "bloqueio(s)", warnings: "aviso(s)", fix: "corrigir ↗", anyway: "Publicar mesmo assim (ciente das pendências)" }
    : { title: "Month-end close", allGood: "✓ All clear to publish.", blockers: "blocker(s)", warnings: "warning(s)", fix: "fix ↗", anyway: "Publish anyway (aware of the issues)" };
  const blocked = preflight.blockers > 0 && !force;
  const generate = () =>
    startAi(async () => {
      setAiError(null);
      const r = await generateReportNarrative(poolId, month);
      if (r.text) setNarrative(r.text);
      if (r.market) setMarket(r.market);
      if (!r.text) setAiError(r.error ?? "—");
    });
  return (
    <details className="relative">
      <summary className="inline-block cursor-pointer rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#2a4a75]">
        {publishLabel}
      </summary>
      <form
        action={formAction}
        className="absolute right-0 z-20 mt-2 w-[520px] max-w-[90vw] rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
      >
        {/* pre-flight de fechamento do mês (#64) */}
        <div className="mb-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-xs font-bold text-slate-700">{tx.title}</span>
            {preflight.blockers > 0 && (
              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-bold text-red-700">{preflight.blockers} {tx.blockers}</span>
            )}
            {preflight.warnings > 0 && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">{preflight.warnings} {tx.warnings}</span>
            )}
          </div>
          {preflight.items.length === 0 ? (
            <p className="text-xs text-emerald-700">{tx.allGood}</p>
          ) : (
            <ul className="max-h-44 space-y-1.5 overflow-y-auto">
              {preflight.items.map((it, i) => (
                <li key={i} className="flex items-start gap-2 text-[11px]">
                  <span className={it.severity === "BLOCKER" ? "text-red-600" : "text-amber-600"}>
                    {it.severity === "BLOCKER" ? "⛔" : "⚠"}
                  </span>
                  <span className="flex-1">
                    <b className="text-slate-700">{it.title}.</b> <span className="text-slate-500">{it.detail}</span>
                    {it.href && (
                      <a href={it.href} className="ml-1 whitespace-nowrap font-semibold text-[#1f3a5f] underline">{tx.fix}</a>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {preflight.blockers > 0 && (
            <label className="mt-2 flex items-center gap-2 border-t border-slate-200 pt-2 text-[11px] text-slate-600">
              <input type="checkbox" name="force" checked={force} onChange={(e) => setForce(e.target.checked)} />
              {tx.anyway}
            </label>
          )}
        </div>
        <div className="mb-1 flex items-baseline justify-between">
          <label className="text-xs font-medium text-slate-500">{narrativeLabel}</label>
          <button
            type="button"
            onClick={generate}
            disabled={aiPending}
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-[11px] font-semibold text-[#1f3a5f] hover:bg-slate-50 disabled:opacity-50"
          >
            {aiPending
              ? lang === "pt"
                ? "Gerando…"
                : "Generating…"
              : lang === "pt"
                ? "✨ Gerar com IA"
                : "✨ Generate with AI"}
          </button>
        </div>
        <textarea
          name="narrative"
          value={narrative}
          onChange={(e) => setNarrative(e.target.value)}
          rows={7}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        <label className="mb-1 mt-2 block text-xs font-medium text-slate-500">{marketLabel}</label>
        <textarea
          name="marketCommentary"
          value={market}
          onChange={(e) => setMarket(e.target.value)}
          rows={4}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
        {aiError && <p className="mt-1 text-xs text-amber-700">{aiError}</p>}
        <button
          type="submit"
          disabled={pending || blocked}
          title={blocked ? (lang === "pt" ? "Resolva os bloqueios ou marque \"publicar mesmo assim\"." : "Resolve blockers or check \"publish anyway\".") : undefined}
          className="mt-2 rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2a4a75] disabled:opacity-50"
        >
          {pending ? (lang === "pt" ? "Publicando…" : "Publishing…") : publishLabel}
        </button>
        {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}
        {state?.ok && <p className="mt-2 text-sm text-emerald-700">✓</p>}
      </form>
    </details>
  );
}
