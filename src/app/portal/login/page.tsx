"use client";

import Image from "next/image";
import { use } from "react";
import { useActionState } from "react";
import { requestPortalLink, type PortalFormState } from "@/lib/actions/portal";

// Login do portal do investidor (#68) — magic-link: o investidor informa o e-mail e recebe
// um link de acesso (sem senha). Resposta sempre genérica (não vaza quais e-mails têm conta).
export default function PortalLoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = use(searchParams);
  const [state, action, pending] = useActionState<PortalFormState, FormData>(requestPortalLink, undefined);

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <Image src="/vixus-logo.png" alt="Vixus Global Investments" width={180} height={62} priority unoptimized />
          <p className="mt-3 text-sm text-slate-500">Portal do investidor</p>
        </div>

        {error === "expired" && (
          <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            O link expirou ou já foi usado. Peça um novo abaixo.
          </p>
        )}

        {state?.ok ? (
          <div className="rounded-lg bg-emerald-50 px-4 py-5 text-center">
            <p className="text-sm text-emerald-800">{state.message}</p>
          </div>
        ) : (
          <form action={action} className="space-y-4">
            <div>
              <label htmlFor="email" className="mb-1 block text-sm font-medium text-slate-700">Seu e-mail</label>
              <input
                id="email"
                name="email"
                type="email"
                required
                autoComplete="email"
                placeholder="voce@empresa.com"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20"
              />
            </div>
            {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="w-full rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white transition hover:bg-[#16304f] disabled:opacity-60"
            >
              {pending ? "Enviando…" : "Receber link de acesso"}
            </button>
            <p className="text-center text-[11.5px] leading-relaxed text-slate-400">
              Enviamos um link seguro para o seu e-mail. Sem senha — é só clicar. O link vale por 15 minutos.
            </p>
          </form>
        )}
      </div>
    </main>
  );
}
