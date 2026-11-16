"use client";

import { useActionState, type ReactNode } from "react";
import type { InvState } from "@/lib/actions/inventory";

// Form genérico p/ server actions (prev, formData) → { error | ok } do módulo Inventory.
export function ActionForm({
  action,
  children,
  className,
  submitLabel,
  submitClass,
  confirm,
}: {
  action: (prev: InvState, fd: FormData) => Promise<InvState>;
  children?: ReactNode;
  className?: string;
  submitLabel: string;
  submitClass?: string;
  confirm?: string;
}) {
  const [state, act, pending] = useActionState<InvState, FormData>(action, undefined);
  return (
    <form
      action={act}
      className={className ?? "space-y-2"}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className={submitClass ?? "rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-xs font-semibold text-white hover:bg-[#16304f] disabled:opacity-50"}
        >
          {pending ? "…" : submitLabel}
        </button>
        {state?.error && <span className="text-xs text-red-700">{state.error}</span>}
        {state?.ok && <span className="text-xs text-emerald-700">{state.ok}</span>}
      </div>
    </form>
  );
}
