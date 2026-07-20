"use client";

import { useState, useTransition } from "react";
import { grantPortalAccess, type PortalFormState } from "@/lib/actions/portal";

// Botão do operador (aba Investidores) para conceder acesso ao portal de um sócio (#68):
// informa o e-mail → cria/vincula o login INVESTOR à entidade → devolve o magic-link p/ copiar.
// Enquanto o e-mail automático (#69) não existe, o operador copia o link e envia.
export function PortalAccessButton({ memberId, defaultEmail }: { memberId: string; defaultEmail?: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [state, setState] = useState<PortalFormState>(undefined);
  const [copied, setCopied] = useState(false);

  const submit = (fd: FormData) => {
    fd.set("memberId", memberId);
    setCopied(false);
    start(async () => setState(await grantPortalAccess(undefined, fd)));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setState(undefined); }}
        className="rounded-md border border-slate-200 px-2 py-0.5 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
        title="Gerar acesso ao portal do investidor"
      >
        portal
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="text-base font-semibold text-slate-800">Acesso ao portal</h3>
              <button onClick={() => setOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <p className="mb-4 text-xs text-slate-500">
              Vincula o login do investidor (por e-mail) à entidade dele e gera um link de acesso. Read-only.
            </p>
            {state?.link ? (
              <div className="space-y-3">
                <p className="text-sm text-emerald-700">✓ {state.message}</p>
                <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                  <input readOnly value={state.link} className="flex-1 bg-transparent text-xs text-slate-600 outline-none" />
                  <button
                    type="button"
                    onClick={() => { navigator.clipboard?.writeText(state.link!); setCopied(true); }}
                    className="rounded-md bg-[#1f3a5f] px-2.5 py-1 text-xs font-semibold text-white hover:bg-[#16304f]"
                  >
                    {copied ? "copiado" : "copiar"}
                  </button>
                </div>
                <p className="text-[11px] text-slate-400">Envie ao investidor — vale por 15 minutos. (O envio por e-mail entra na próxima leva.)</p>
              </div>
            ) : (
              <form action={submit} className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-500">E-mail do investidor</label>
                  <input
                    name="email"
                    type="email"
                    required
                    defaultValue={defaultEmail}
                    placeholder="voce@empresa.com"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20"
                  />
                </div>
                {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
                <div className="flex items-center justify-end gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">Cancelar</button>
                  <button type="submit" disabled={pending} className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-60">
                    {pending ? "Gerando…" : "Gerar link"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </>
  );
}
