"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { uploadBankLoi, type CatalogFormState } from "@/lib/actions/catalog";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-sm font-medium text-slate-700";

// Upload de Letter of Intent: a Claude extrai os termos e cria/atualiza o BankProfile
// (revisável no modal); o LOI fica arquivado com o JSON da extração. Usado no catálogo e
// dentro do simulador (comparador) — refresh após o ok p/ o banco novo entrar nas listas.
export function BankLoiUpload({ banks }: { banks: Array<{ id: string; name: string }> }) {
  const [state, formAction, pending] = useActionState<CatalogFormState, FormData>(
    uploadBankLoi,
    undefined,
  );
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3">
      <div className="min-w-64 flex-1">
        <label className={labelClass}>Letter of Intent (PDF)</label>
        <input name="file" type="file" accept="application/pdf" required className={inputClass} />
      </div>
      <div className="w-64">
        <label className={labelClass}>Aplicar a</label>
        <select name="targetBankId" defaultValue="" className={inputClass}>
          <option value="">Criar banco novo (do LOI)</option>
          {banks.map((b) => (
            <option key={b.id} value={b.id}>
              Atualizar: {b.name}
            </option>
          ))}
        </select>
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
      >
        {pending ? "Analisando com AI… (~30s)" : "↑ Ler LOI com AI"}
      </button>
      <p className="w-full text-xs text-slate-400">
        A extração pré-preenche o perfil do banco — revise no modal antes de usar em simulações.
      </p>
      {state?.error && <p className="w-full text-sm text-red-600">{state.error}</p>}
      {state?.ok && (
        <p className="w-full text-xs text-emerald-600">
          LOI lido e aplicado — confira o perfil na lista acima e o arquivo na lista de LOIs.
        </p>
      )}
    </form>
  );
}
