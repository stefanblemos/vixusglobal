"use client";

import { useActionState, useState } from "react";
import {
  acceptSubscription,
  createSubscriptionInvite,
  deleteSubscription,
  rejectSubscription,
  type SubFormState,
} from "@/lib/actions/subscriptions";
import type { OwnerOption } from "@/components/pool-investor-forms";

// Painel do operador para a subscrição online (mock aprovado 19/07/2026): gera link de
// convite e mostra a fila; "Aceitar" cria o sócio, gera o pacote DOCX e arquiva o perfil.

export type SubscriptionRow = {
  id: string;
  token: string;
  who: string; // nome legal (do wizard) ou entidade vinculada ou e-mail
  units: number | null;
  commitment: number | null;
  status: "INVITED" | "IN_PROGRESS" | "SIGNED" | "ACCEPTED" | "REJECTED";
  prefilled: boolean;
  signedAt: string | null;
  createdAt: string;
};

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 0 });

const STATUS: Record<SubscriptionRow["status"], { label: string; cls: string }> = {
  INVITED: { label: "convidado", cls: "bg-slate-100 text-slate-500" },
  IN_PROGRESS: { label: "preenchendo", cls: "bg-amber-50 text-amber-700" },
  SIGNED: { label: "assinado", cls: "bg-blue-50 text-blue-700" },
  ACCEPTED: { label: "aceito · sócio", cls: "bg-green-50 text-green-700" },
  REJECTED: { label: "rejeitado", cls: "bg-red-50 text-red-600" },
};

export function PoolSubscriptionsPanel({
  poolId,
  origin,
  newMemberLocked,
  owners,
  rows,
}: {
  poolId: string;
  origin: string;
  newMemberLocked: boolean;
  owners: OwnerOption[];
  rows: SubscriptionRow[];
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [inviteState, inviteAction, invitePending] = useActionState<SubFormState, FormData>(
    createSubscriptionInvite.bind(null, poolId),
    undefined,
  );
  const [acceptState, acceptAction, acceptPending] = useActionState<SubFormState, FormData>(
    acceptSubscription,
    undefined,
  );

  const pending = rows.filter((r) => r.status !== "ACCEPTED" && r.status !== "REJECTED");
  const link = (token: string) => `${origin}/subscribe/${token}`;

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Subscrições online</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            O investidor preenche pelo link; o pacote (Subscription + Joinder) é gerado e assinado sem papel.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          disabled={newMemberLocked}
          title={newMemberLocked ? "Cap table fechado — convites só na janela de Funding." : undefined}
          className={`rounded-lg border px-3.5 py-2 text-xs font-semibold ${
            newMemberLocked
              ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300"
              : "border-[#1f3a5f] bg-[#1f3a5f] text-white hover:bg-[#16304f]"
          }`}
        >
          {newMemberLocked ? "🔒 Convidar" : "+ Convidar investidor"}
        </button>
      </div>

      {open && !newMemberLocked && (
        <form action={inviteAction} className="border-b border-slate-100 bg-slate-50 px-5 py-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Investidor recorrente (opcional)</label>
              <select name="owner" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm">
                <option value="">— novo investidor (preenche do zero) —</option>
                {owners.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">E-mail (opcional)</label>
              <input name="email" type="email" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="investidor@email.com" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-slate-600">Units sugeridas (opcional)</label>
              <input name="units" type="number" min="1" className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm" placeholder="150" />
            </div>
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Vinculando um investidor que já participou, o wizard abre com os dados dele pré-preenchidos e um aviso para revisar.
          </p>
          {inviteState?.error && <p className="mt-2 text-sm text-red-600">{inviteState.error}</p>}
          <button disabled={invitePending} className="mt-3 rounded-lg bg-[#1f3a5f] px-5 py-2 text-sm font-semibold text-white disabled:opacity-40">
            {invitePending ? "Gerando link…" : "Gerar link de convite"}
          </button>
        </form>
      )}

      {rows.length === 0 ? (
        <p className="px-5 py-6 text-center text-sm text-slate-400">Nenhuma subscrição ainda.</p>
      ) : (
        <div className="divide-y divide-slate-50">
          {rows.map((r) => (
            <div key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-slate-800">{r.who}</span>
                  {r.prefilled && (
                    <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700" title="Pré-preenchido de participação anterior">
                      recorrente
                    </span>
                  )}
                  <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${STATUS[r.status].cls}`}>
                    {STATUS[r.status].label}
                  </span>
                </div>
                <div className="mt-0.5 text-[11px] text-slate-400">
                  {r.commitment != null ? `${r.units} units · ${money(r.commitment)}` : "sem valor definido"}
                  {r.signedAt && ` · assinado ${r.signedAt}`}
                </div>
              </div>

              {(r.status === "INVITED" || r.status === "IN_PROGRESS") && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard?.writeText(link(r.token));
                    setCopied(r.id);
                    setTimeout(() => setCopied((c) => (c === r.id ? null : c)), 1500);
                  }}
                  className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
                >
                  {copied === r.id ? "copiado ✓" : "copiar link"}
                </button>
              )}
              <a
                href={link(r.token)}
                target="_blank"
                rel="noreferrer"
                className="rounded-md border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
              >
                abrir ↗
              </a>

              {r.status === "SIGNED" && (
                <>
                  <form action={acceptAction}>
                    <input type="hidden" name="subscriptionId" value={r.id} />
                    <button disabled={acceptPending} className="rounded-md bg-green-600 px-3 py-1 text-[11px] font-semibold text-white hover:bg-green-700 disabled:opacity-40">
                      Aceitar admissão
                    </button>
                  </form>
                  <form action={rejectSubscription}>
                    <input type="hidden" name="subscriptionId" value={r.id} />
                    <button className="text-[11px] text-slate-300 hover:text-red-500">rejeitar</button>
                  </form>
                </>
              )}
              {(r.status === "INVITED" || r.status === "IN_PROGRESS" || r.status === "REJECTED") && (
                <form action={deleteSubscription}>
                  <input type="hidden" name="subscriptionId" value={r.id} />
                  <button className="text-xs text-slate-300 hover:text-red-500" title="Excluir convite">✕</button>
                </form>
              )}
            </div>
          ))}
        </div>
      )}

      {acceptState?.error && <p className="px-5 py-2 text-sm text-red-600">{acceptState.error}</p>}
      {pending.length > 0 && (
        <p className="border-t border-slate-50 px-5 py-2 text-[11px] text-slate-400">
          {pending.length} em andamento · aceite gera o pacote no Data Room do sócio e libera o portal.
        </p>
      )}
    </section>
  );
}
