"use client";

import { useState, useTransition } from "react";
import { grantPortalAccess, type PortalFormState } from "@/lib/actions/portal";

// Convite ao portal por sócio (aba Investidores, #68). Mostra o ESTADO — sem acesso →
// convidado → ativo (assim que o investidor entra pela 1ª vez) — e o botão de convidar/
// reenviar. Enquanto o envio por e-mail (#69) não existe, devolve o link p/ o operador enviar.
export type PortalStatus = {
  status: "NONE" | "INVITED" | "ACTIVE";
  email: string | null;
  invitedAt: Date | string | null;
  lastLoginAt: Date | string | null;
};

const fmtWhen = (d: Date | string | null) => {
  if (!d) return "";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
};

export function PortalAccessButton({
  memberId,
  portal,
}: {
  memberId: string;
  portal: PortalStatus;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [state, setState] = useState<PortalFormState>(undefined);
  const [copied, setCopied] = useState(false);
  const defaultEmail = portal.email ?? undefined;

  const submit = (fd: FormData) => {
    fd.set("memberId", memberId);
    setCopied(false);
    start(async () => setState(await grantPortalAccess(undefined, fd)));
  };

  return (
    <>
      {portal.status === "ACTIVE" ? (
        <span
          className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] font-bold text-emerald-700"
          title={`Entrou no portal em ${fmtWhen(portal.lastLoginAt)}${portal.email ? ` · ${portal.email}` : ""}`}
        >
          portal ativo ✓
        </span>
      ) : portal.status === "INVITED" ? (
        <span
          className="rounded-full bg-amber-50 px-2 py-0.5 text-[10.5px] font-bold text-amber-700"
          title={`Convidado em ${fmtWhen(portal.invitedAt)}${portal.email ? ` · ${portal.email}` : ""} — ainda não entrou`}
        >
          convidado
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => { setOpen(true); setState(undefined); }}
        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${
          portal.status === "NONE"
            ? "border-[#1f3a5f]/30 bg-[#e8eef7] text-[#1f3a5f] hover:bg-[#dbe6f3]"
            : "border-slate-200 text-slate-400 hover:bg-slate-50"
        }`}
        title={portal.status === "NONE" ? "Enviar convite de acesso ao portal" : "Gerar um novo link de acesso"}
      >
        {portal.status === "NONE" ? "convidar" : "reenviar"}
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
