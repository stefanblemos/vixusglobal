"use client";

import { useActionState } from "react";
import { analyzeAndStoreTaxReturn, type IrState } from "@/lib/actions/ir";

export function IrUpload() {
  const [state, formAction, pending] = useActionState<IrState, FormData>(
    analyzeAndStoreTaxReturn,
    undefined,
  );

  return (
    <form action={formAction} className="rounded-xl border border-slate-200 bg-white p-5">
      <label className="mb-1 block text-sm font-medium text-slate-700">
        Upload an income tax return (PDF)
      </label>
      <p className="mb-3 text-sm text-slate-500">
        Claude reads it and extracts the partners (sócios) and the tax treatment — no tax experience
        needed.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          name="file"
          accept="application/pdf"
          required
          className="text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-4 file:py-2 file:text-sm file:font-medium file:text-slate-700 hover:file:bg-slate-200"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
        >
          {pending ? "Analyzing with Claude…" : "Analyze"}
        </button>
      </div>
      {pending && (
        <p className="mt-3 text-sm text-slate-500">
          Reading the document and extracting partners and tax treatment — this can take a few
          seconds.
        </p>
      )}
      {state?.error && <p className="mt-3 text-sm text-red-600">{state.error}</p>}
    </form>
  );
}
