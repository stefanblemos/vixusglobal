"use client";

import { useState } from "react";
import Link from "next/link";
import { deleteMember } from "@/lib/actions/pools";
import {
  AddContributionForm,
  AddMemberForm,
  TransferUnitsForm,
  type MemberOption,
  type OwnerOption,
} from "@/components/pool-investor-forms";
import { CreateCapitalCallForm } from "@/components/pool-capital-forms";
import { PoolSubscriptionsPanel, type SubscriptionRow } from "@/components/pool-subscriptions-panel";
import { PortalAccessButton } from "@/components/portal-access-button";

// Aba Investidores (mock UX 2/6 aprovado): captação no topo, UMA ação por vez em painel,
// cap table com % visual + atalho "+ aporte" por sócio, saída de sócio legível.

const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 });

export type InvestorRow = {
  memberId: string;
  name: string;
  role: "MANAGER" | "INVESTOR";
  invested: number;
  units: number;
  pct: number; // 0–100
  // sócio que zerou via transferência: data e (se identificável) quem comprou as units
  exited: { date: string; toName: string | null } | null;
  hasEntries: boolean;
  // Portal do investidor (#68): sem acesso → convidado → ativo (já entrou ao menos uma vez)
  portal: {
    status: "NONE" | "INVITED" | "ACTIVE";
    email: string | null;
    invitedAt: Date | string | null;
    lastLoginAt: Date | string | null;
  };
};

export type CapitalCallRow = {
  id: string;
  date: string;
  reason: string;
  total: number;
  paidCount: number;
  lineCount: number;
};

type Panel = "aporte" | "socio" | "transfer" | "call" | null;

export function PoolInvestorsTab({
  poolId,
  poolStatus,
  raised,
  target,
  totalUnits,
  unitPrice,
  rows,
  lastContribution,
  capitalCalls,
  memberOptions,
  ownerOptions,
  suggestedCallAmount,
  distOptions = [],
  subscriptions = [],
  subscribeOrigin = "",
}: {
  poolId: string;
  poolStatus: string; // fora de FUNDING, entrada de sócio NOVO é travada (aportes seguem)
  raised: number;
  target: number | null; // snapshot da provisão na conversão (targetAmount)
  totalUnits: number;
  unitPrice: number;
  rows: InvestorRow[];
  lastContribution: { name: string; amount: number; date: string } | null;
  capitalCalls: CapitalCallRow[];
  memberOptions: MemberOption[];
  ownerOptions: OwnerOption[];
  suggestedCallAmount: string | null;
  // rolagem direta no aporte (regra da carteira): distribuições do pool p/ vincular
  distOptions?: Array<{ id: string; label: string }>;
  subscriptions?: SubscriptionRow[];
  subscribeOrigin?: string;
}) {
  const [panel, setPanel] = useState<Panel>(null);
  const [presetMemberId, setPresetMemberId] = useState<string | undefined>(undefined);

  const active = rows.filter((r) => !r.exited);
  const pctRaised = target && target > 0 ? Math.min(100, (raised / target) * 100) : null;
  const shortfall = target != null ? Math.max(0, target - raised) : null;

  const toggle = (p: Panel) => {
    setPresetMemberId(undefined);
    setPanel((cur) => (cur === p ? null : p));
  };
  const aporteFor = (memberId: string) => {
    setPresetMemberId(memberId);
    setPanel("aporte");
    // painel fica no card de captação, acima da tabela — sobe até ele
    document.getElementById("investors-actions")?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // fora da captação (Active+), o cap table fecha p/ SÓCIOS NOVOS — aportes de quem já
  // participa e transferências continuam liberados (regra do Stefan, 16/07)
  const newMemberLocked = poolStatus !== "FUNDING";

  const abtn = (p: Panel, label: string, primary = false, locked = false) => (
    <button
      type="button"
      onClick={() => !locked && toggle(p)}
      disabled={locked}
      title={
        locked
          ? "Cap table fechado — o pool saiu da captação. Sócio novo só na janela de Funding; aportes dos sócios atuais e transferências continuam liberados."
          : undefined
      }
      className={`rounded-lg border px-3.5 py-2 text-xs font-semibold transition ${
        locked
          ? "cursor-not-allowed border-slate-200 bg-slate-50 text-slate-300"
          : panel === p
            ? "border-[#1f3a5f] bg-blue-50 text-[#1f3a5f]"
            : primary
              ? "border-[#1f3a5f] bg-[#1f3a5f] text-white hover:bg-[#16304f]"
              : "border-slate-300 bg-white text-slate-600 hover:bg-slate-50"
      }`}
    >
      {locked ? `🔒 ${label}` : label}
    </button>
  );

  return (
    <>
      {/* 1. captação — o número que importa primeiro */}
      <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Captação</h2>
            <div className="mt-1 text-2xl font-extrabold tabular-nums text-slate-800">
              {money(raised)}{" "}
              {target != null && (
                <span className="text-sm font-medium text-slate-400">de {money(target)} provisionados</span>
              )}
            </div>
          </div>
          <div className="text-right">
            {pctRaised != null && (
              <span className="rounded-full bg-blue-50 px-2.5 py-1 text-xs font-bold text-[#1f3a5f]">
                {Math.round(pctRaised)}% captado
              </span>
            )}
            {shortfall != null && shortfall > 0 && (
              <div className="mt-1 text-[11px] text-slate-400">
                faltam <b className="text-amber-700">{money(shortfall)}</b> ·{" "}
                <Link href={`/pools/${poolId}/provision`} className="underline hover:text-slate-600">
                  ver Provisão
                </Link>
              </div>
            )}
          </div>
        </div>
        {pctRaised != null && (
          <div className="mt-2.5 h-3 overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-gradient-to-r from-[#1f3a5f] to-[#2d5288]"
              style={{ width: `${pctRaised}%` }}
            />
          </div>
        )}
        <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[11px] text-slate-500">
          <span>
            {totalUnits.toLocaleString("en-US")} units · {money(unitPrice)}/unit
          </span>
          <span>
            {active.length} {active.length === 1 ? "sócio ativo" : "sócios ativos"}
            {lastContribution &&
              ` · último aporte ${lastContribution.date} (${lastContribution.name}, ${money(lastContribution.amount)})`}
          </span>
        </div>

        {/* 2. ações — uma por vez, painel abre embaixo */}
        <div id="investors-actions" className="mt-3.5 flex flex-wrap gap-2">
          {abtn("aporte", "+ Aporte", true)}
          {abtn("socio", "+ Sócio", false, newMemberLocked)}
          {abtn("transfer", "⇄ Transferência")}
          {abtn("call", "📣 Capital call")}
        </div>
        {panel && (
          <div className="mt-3 rounded-lg border border-blue-100 bg-slate-50 p-4">
            {panel === "aporte" && (
              <AddContributionForm
                key={presetMemberId ?? "none"}
                poolId={poolId}
                members={memberOptions}
                defaultMemberId={presetMemberId}
                distOptions={distOptions}
              />
            )}
            {panel === "socio" && <AddMemberForm poolId={poolId} owners={ownerOptions} />}
            {panel === "transfer" && <TransferUnitsForm poolId={poolId} members={memberOptions} />}
            {panel === "call" && (
              <CreateCapitalCallForm poolId={poolId} suggestedAmount={suggestedCallAmount} />
            )}
          </div>
        )}
      </section>

      {/* 2.5 subscrições online — convite + fila de aceite */}
      <PoolSubscriptionsPanel
        poolId={poolId}
        origin={subscribeOrigin}
        newMemberLocked={newMemberLocked}
        owners={ownerOptions}
        rows={subscriptions}
      />

      {/* 3. cap table com % visual */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Cap table</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            % derivado das units — nunca digitado. Transferências movem units sem diluir ninguém.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b border-slate-100">
                <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Sócio</th>
                <th className="px-2 py-2"></th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Investido</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400">Units</th>
                <th className="px-3 py-2 text-right text-xs font-medium uppercase tracking-wide text-slate-400" style={{ width: 180 }}>%</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-5 py-6 text-center text-sm text-slate-400">
                    Nenhum sócio ainda — adicione o manager (Vixus) e as empresas investidoras em “+ Sócio”.
                  </td>
                </tr>
              )}
              {rows.map((r) =>
                r.exited ? (
                  <tr key={r.memberId} className="border-b border-slate-50">
                    <td className="px-4 py-2 text-sm text-slate-400 line-through">{r.name}</td>
                    <td className="px-2 py-2 text-[11px] text-slate-400" colSpan={2}>
                      saiu {r.exited.date}
                      {r.exited.toName ? ` → units p/ ${r.exited.toName}` : ""}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums text-slate-300">0</td>
                    <td className="px-3 py-2 text-right text-sm text-slate-300">—</td>
                    <td></td>
                  </tr>
                ) : (
                  <tr key={r.memberId} className="border-b border-slate-50">
                    <td className="px-4 py-2 text-sm font-medium text-slate-800">{r.name}</td>
                    <td className="px-2 py-2">
                      {r.role === "MANAGER" && (
                        <span className="rounded-full bg-[#1f3a5f]/10 px-2 py-0.5 text-[10.5px] font-bold text-[#1f3a5f]">
                          Manager
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums text-slate-700">{money(r.invested)}</td>
                    <td className="px-3 py-2 text-right text-sm tabular-nums text-slate-700">
                      {r.units.toLocaleString("en-US")}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center justify-end gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className={`h-full rounded-full ${r.role === "MANAGER" ? "bg-[#1f3a5f]" : "bg-slate-400"}`}
                            style={{ width: `${Math.min(100, r.pct)}%` }}
                          />
                        </div>
                        <span className="w-16 text-right text-sm font-semibold tabular-nums text-slate-800">
                          {r.pct.toFixed(2)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => aporteFor(r.memberId)}
                          className="rounded-md border border-blue-100 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-[#1f3a5f] hover:bg-blue-100"
                        >
                          + aporte
                        </button>
                        {r.role === "INVESTOR" && <PortalAccessButton memberId={r.memberId} portal={r.portal} />}
                        {r.units === 0 && !r.hasEntries && (
                          <form action={deleteMember}>
                            <input type="hidden" name="memberId" value={r.memberId} />
                            <button type="submit" className="text-xs text-slate-300 hover:text-red-500" title="Remover sócio">
                              ✕
                            </button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ),
              )}
              {rows.length > 0 && (
                <tr className="bg-slate-50/60">
                  <td className="px-4 py-2 text-sm font-semibold text-slate-800">Total</td>
                  <td></td>
                  <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">{money(raised)}</td>
                  <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                    {totalUnits.toLocaleString("en-US")}
                  </td>
                  <td className="px-3 py-2 text-right text-sm font-semibold tabular-nums">
                    {totalUnits === 0 ? "—" : "100.00%"}
                  </td>
                  <td></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="border-t border-slate-100 px-5 py-3 text-[11px] text-slate-400">
          Sócio que zerou (transferiu tudo) fica na linha apagada com a história — a trilha completa
          continua no Capital ledger.
        </p>
      </section>

      {/* 4. capital calls integradas */}
      <section className="rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">Capital calls</h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Quando custos e change orders passam do captado, a chamada rateia pro rata às units e
            gera o relatório para os sócios.
          </p>
        </div>
        {capitalCalls.length === 0 ? (
          <div className="px-5 py-5">
            <div className="rounded-lg border border-dashed border-slate-300 px-4 py-4 text-center text-xs text-slate-400">
              Nenhuma capital call. Para criar, use <b>📣 Capital call</b> na barra de ações acima.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-slate-50">
            {capitalCalls.map((c) => (
              <Link
                key={c.id}
                href={`/pools/${poolId}/calls/${c.id}`}
                className="flex items-center justify-between px-5 py-2.5 text-sm hover:bg-slate-50/70"
              >
                <span className="text-slate-500">{c.date}</span>
                <span className="flex-1 px-4 font-medium text-slate-700">{c.reason}</span>
                <span className="font-medium tabular-nums text-slate-800">{money(c.total)}</span>
                <span
                  className={`ml-4 rounded-full px-2 py-0.5 text-xs ${
                    c.paidCount === c.lineCount ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                  }`}
                >
                  {c.paidCount}/{c.lineCount} recebidos
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>
    </>
  );
}
