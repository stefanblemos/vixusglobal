"use client";

import { useActionState } from "react";
import { saveInvestorLegacy, unlockInvestorLegacy, type LegacyFormState } from "@/lib/actions/investor-legacy";

/**
 * Saldo de abertura do investidor (projetos anteriores encerrados) — SÓ ADMIN.
 * Travado depois de salvo: os valores viram somente-leitura e corrigir exige destravar
 * explicitamente (ação auditada). Não é lançamento rastreado, é um agregado informado.
 */

export type LegacyValues = {
  invested: number;
  returned: number;
  since: string | null; // yyyy-mm-dd
  note: string | null;
  locked: boolean;
  exists: boolean;
};

const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const input =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const label = "mb-1 block text-[11px] font-medium text-slate-500";

export function InvestorLegacyPanel({ entityKey, values }: { entityKey: string; values: LegacyValues }) {
  const [saveState, saveAction, saving] = useActionState<LegacyFormState, FormData>(saveInvestorLegacy, undefined);
  const [unlockState, unlockAction, unlocking] = useActionState<LegacyFormState, FormData>(unlockInvestorLegacy, undefined);

  const locked = values.locked;

  return (
    <section className="rounded-xl border border-slate-200 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
          Saldo de abertura — projetos anteriores
        </h2>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-500">só admin</span>
        {locked && (
          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">🔒 travado</span>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-400">
        O que este investidor já aportou e já recebeu em projetos encerrados que não entram no sistema. Credita a
        carteira — o próximo aporte dele conta como reuso. <b>Não altera</b> TIR, NAV, units nem o valor projetado,
        que vêm dos fluxos datados dos pools atuais.
      </p>

      {locked ? (
        <>
          <div className="mt-3 grid gap-2 sm:grid-cols-4">
            <Info label="Aportado antes" value={money(values.invested)} />
            <Info label="Devolvido antes" value={money(values.returned)} />
            <Info label="Desde" value={values.since ?? "—"} />
            <Info label="Resultado" value={money(values.returned - values.invested)} />
          </div>
          {values.note && <p className="mt-2 text-[11.5px] text-slate-500">{values.note}</p>}
          <form action={unlockAction} className="mt-3 flex items-center gap-3">
            <input type="hidden" name="entityKey" value={entityKey} />
            <button
              type="submit"
              disabled={unlocking}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:border-slate-400 disabled:opacity-50"
            >
              {unlocking ? "Destravando…" : "Destravar para corrigir"}
            </button>
            <span className="text-[11px] text-slate-400">Fica registrado na auditoria quem destravou e alterou.</span>
          </form>
          {unlockState?.error && <p className="mt-2 text-sm text-red-600">{unlockState.error}</p>}
        </>
      ) : (
        <form action={saveAction} className="mt-3">
          <input type="hidden" name="entityKey" value={entityKey} />
          <div className="grid gap-3 sm:grid-cols-4">
            <div>
              <label className={label}>Aportado antes ($)</label>
              <input name="invested" defaultValue={values.exists ? values.invested : ""} placeholder="50000" className={input} />
            </div>
            <div>
              <label className={label}>Devolvido antes ($)</label>
              <input name="returned" defaultValue={values.exists ? values.returned : ""} placeholder="60000" className={input} />
            </div>
            <div>
              <label className={label}>Desde (1º investimento)</label>
              <input name="since" type="date" defaultValue={values.since ?? ""} className={input} />
            </div>
            <div>
              <label className={label}>Nota</label>
              <input name="note" defaultValue={values.note ?? ""} placeholder="PH-1 e PH-2, encerrados" className={input} />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={saving}
              className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar e travar"}
            </button>
            <span className="text-[11px] text-slate-400">Depois de salvo trava — corrigir exige destravar.</span>
          </div>
          {saveState?.error && <p className="mt-2 text-sm text-red-600">{saveState.error}</p>}
        </form>
      )}
    </section>
  );
}

function Info({ label: l, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
      <div className="text-[9px] uppercase tracking-wider text-slate-400">{l}</div>
      <div className="text-[15px] font-extrabold tabular-nums text-slate-900">{value}</div>
    </div>
  );
}
