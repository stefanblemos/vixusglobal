"use client";

import { useActionState } from "react";
import { publishMonthlyReport, type FormState } from "@/lib/actions/pool-docs";
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
  publishLabel,
  narrativeLabel,
  lang,
}: {
  poolId: string;
  month: string;
  defaultNarrative: string;
  publishLabel: string;
  narrativeLabel: string;
  lang: Lang;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    publishMonthlyReport.bind(null, poolId, month),
    undefined,
  );
  return (
    <details className="relative">
      <summary className="inline-block cursor-pointer rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-bold text-white hover:bg-[#2a4a75]">
        {publishLabel}
      </summary>
      <form
        action={formAction}
        className="absolute right-0 z-20 mt-2 w-[520px] max-w-[90vw] rounded-xl border border-slate-200 bg-white p-4 shadow-lg"
      >
        <label className="mb-1 block text-xs font-medium text-slate-500">{narrativeLabel}</label>
        <textarea
          name="narrative"
          defaultValue={defaultNarrative}
          rows={6}
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        />
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
