"use client";

import { useActionState, useState, useTransition } from "react";
import { generateReportNarrative, publishMonthlyReport, type FormState } from "@/lib/actions/pool-docs";
import type { Lang } from "@/lib/pools/i18n";

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
}: {
  poolId: string;
  month: string;
  defaultNarrative: string;
  defaultMarket?: string;
  publishLabel: string;
  narrativeLabel: string;
  marketLabel: string;
  lang: Lang;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    publishMonthlyReport.bind(null, poolId, month),
    undefined,
  );
  // prosa IA: gera narrativa + comentário de mercado p/ revisão — publicar continua manual
  const [narrative, setNarrative] = useState(defaultNarrative);
  const [market, setMarket] = useState(defaultMarket);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiPending, startAi] = useTransition();
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
          disabled={pending}
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
