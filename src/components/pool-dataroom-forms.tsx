"use client";

import { useActionState } from "react";
import { uploadPoolDocument, type FormState } from "@/lib/actions/pool-docs";
import type { Lang } from "@/lib/pools/i18n";

// Upload do data room (Fase 3): multi-PDF por categoria (docType do PoolDocument)
const CATEGORIES: Array<[string, string, string]> = [
  // [value, label EN, label PT]
  ["OPERATING_AGREEMENT", "Operating Agreement", "Operating Agreement"],
  ["SUBSCRIPTION", "Subscription", "Subscription"],
  ["NOTE", "Participation note", "Nota participativa"],
  ["CAP_TABLE", "Cap table", "Cap table"],
  ["STATEMENT", "Statement / report", "Statement / report"],
  ["CLOSING_STMT", "Closing statement (HUD)", "Closing statement (HUD)"],
  ["OTHER", "Other (EIN, certificates, contracts)", "Outros (EIN, certidões, contratos)"],
];

export function UploadPoolDocForm({ poolId, lang }: { poolId: string; lang: Lang }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    uploadPoolDocument.bind(null, poolId),
    undefined,
  );
  const pt = lang === "pt";
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="w-64">
        <label className="mb-1 block text-xs font-medium text-slate-500">
          {pt ? "Categoria" : "Category"}
        </label>
        <select
          name="docType"
          defaultValue="OTHER"
          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
        >
          {CATEGORIES.map(([v, en, ptl]) => (
            <option key={v} value={v}>
              {pt ? ptl : en}
            </option>
          ))}
        </select>
      </div>
      <div className="min-w-56 flex-1">
        <label className="mb-1 block text-xs font-medium text-slate-500">
          {pt ? "Arquivo(s) PDF — até 6, 10MB cada" : "PDF file(s) — up to 6, 10MB each"}
        </label>
        <input
          name="file"
          type="file"
          accept="application/pdf"
          multiple
          required
          className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-500 file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-xs file:font-semibold file:text-slate-600"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#2a4a75] disabled:opacity-50"
      >
        {pending ? (pt ? "Enviando…" : "Uploading…") : pt ? "Enviar" : "Upload"}
      </button>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
