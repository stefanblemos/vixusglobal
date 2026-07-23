"use client";

import { useState, useTransition } from "react";
import { confirmPortalPayout, type PayoutFormState } from "@/lib/actions/payout";

// #69 — card "Dados de recebimento" no portal do investidor. Dois passos: preencher →
// revisar e ATESTAR (click-wrap). O atesto vira a conta de registro e libera o pagamento.
// Escopado à entidade do login. Editar depois exige confirmar de novo.

export type PortalAccount = {
  status: "NONE" | "PENDING" | "CONFIRMED";
  beneficiaryName: string;
  bankName: string;
  routingNumber: string | null;
  accountNumber: string;
  accountType: string | null;
  swift: string | null;
  iban: string | null;
  bankAddress: string | null;
  confirmedAt: string | null;
};

const inp =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const lbl = "mb-1 block text-xs font-medium text-slate-500";
const mask = (a: string) => (a ? "••" + a.replace(/\D/g, "").slice(-4) : "—");

export function PortalPayoutCard({
  entityKey,
  entityName,
  account,
}: {
  entityKey: string;
  entityName: string;
  account: PortalAccount;
}) {
  const [mode, setMode] = useState<"view" | "edit" | "review">(
    account.status === "CONFIRMED" ? "view" : "edit",
  );
  const [intl, setIntl] = useState(Boolean(account.swift || account.iban));
  const [f, setF] = useState({
    beneficiaryName: account.beneficiaryName || entityName,
    bankName: account.bankName,
    routingNumber: account.routingNumber ?? "",
    accountNumber: account.accountNumber,
    accountType: account.accountType ?? "checking",
    swift: account.swift ?? "",
    iban: account.iban ?? "",
    bankAddress: account.bankAddress ?? "",
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setF((s) => ({ ...s, [k]: e.target.value }));

  const [pending, start] = useTransition();
  const [state, setState] = useState<PayoutFormState>(undefined);
  const action = (fd: FormData) =>
    start(async () => {
      const res = await confirmPortalPayout(entityKey, undefined, fd);
      setState(res);
      if (res?.ok) setMode("view");
    });

  // resumo confirmado (colapsado)
  if (mode === "view" && account.status === "CONFIRMED") {
    return (
      <section className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50/50 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-emerald-800">
              <span>✓</span> Conta de recebimento confirmada
            </h2>
            <p className="mt-0.5 text-xs text-emerald-700/80">
              {account.bankName} {mask(account.accountNumber)}
              {account.confirmedAt ? ` · confirmada em ${account.confirmedAt}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setMode("edit")}
            className="rounded-lg border border-emerald-300 bg-white px-3 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
          >
            Alterar conta
          </button>
        </div>
      </section>
    );
  }

  const canReview = f.beneficiaryName.trim() && f.bankName.trim() && (f.accountNumber.trim() || f.iban.trim());

  return (
    <section className="mb-5 rounded-xl border border-[#1f3a5f]/30 bg-white px-5 py-4">
      <div className="flex items-start gap-2">
        <div className="flex-1">
          <h2 className="text-sm font-semibold text-[#1f3a5f]">Dados de recebimento</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {account.status === "PENDING"
              ? "Revise a conta abaixo e confirme para poder receber suas distribuições."
              : "Cadastre onde receber suas distribuições. É preciso confirmar para receber."}
          </p>
        </div>
        {account.status !== "NONE" && (
          <span
            className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${
              account.status === "CONFIRMED" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
            }`}
          >
            {account.status === "CONFIRMED" ? "Confirmada" : "Pendente"}
          </span>
        )}
      </div>

      {mode === "edit" && (
        <div className="mt-3 space-y-3">
          <div>
            <label className={lbl}>Titular da conta (beneficiário)</label>
            <input value={f.beneficiaryName} onChange={set("beneficiaryName")} className={inp} />
          </div>
          <div>
            <label className={lbl}>Banco</label>
            <input value={f.bankName} onChange={set("bankName")} className={inp} />
          </div>
          {!intl ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className={lbl}>Routing (ABA)</label>
                <input value={f.routingNumber} onChange={set("routingNumber")} className={inp} inputMode="numeric" />
              </div>
              <div>
                <label className={lbl}>Nº da conta</label>
                <input value={f.accountNumber} onChange={set("accountNumber")} className={inp} />
              </div>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={lbl}>SWIFT/BIC</label>
                  <input value={f.swift} onChange={set("swift")} className={inp} />
                </div>
                <div>
                  <label className={lbl}>Nº da conta</label>
                  <input value={f.accountNumber} onChange={set("accountNumber")} className={inp} />
                </div>
              </div>
              <div>
                <label className={lbl}>IBAN (se houver)</label>
                <input value={f.iban} onChange={set("iban")} className={inp} />
              </div>
              <div>
                <label className={lbl}>Endereço do banco</label>
                <input value={f.bankAddress} onChange={set("bankAddress")} className={inp} />
              </div>
            </>
          )}
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <select value={f.accountType} onChange={set("accountType")} className="rounded-lg border border-slate-300 px-2 py-1 text-xs">
                <option value="checking">Corrente</option>
                <option value="savings">Poupança</option>
              </select>
            </label>
            <label className="flex items-center gap-2 text-xs text-slate-500">
              <input type="checkbox" checked={intl} onChange={(e) => setIntl(e.target.checked)} />
              Conta internacional
            </label>
          </div>
          <div className="flex justify-end">
            <button
              type="button"
              disabled={!canReview}
              onClick={() => setMode("review")}
              className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-50"
            >
              Revisar →
            </button>
          </div>
        </div>
      )}

      {mode === "review" && (
        <form action={action} className="mt-3">
          {/* valores do passo 1 viajam como hidden — o form é a fonte da verdade no submit */}
          <input type="hidden" name="beneficiaryName" value={f.beneficiaryName} />
          <input type="hidden" name="bankName" value={f.bankName} />
          <input type="hidden" name="routingNumber" value={intl ? "" : f.routingNumber} />
          <input type="hidden" name="accountNumber" value={f.accountNumber} />
          <input type="hidden" name="accountType" value={f.accountType} />
          <input type="hidden" name="swift" value={intl ? f.swift : ""} />
          <input type="hidden" name="iban" value={intl ? f.iban : ""} />
          <input type="hidden" name="bankAddress" value={intl ? f.bankAddress : ""} />

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <Review k="Titular" v={f.beneficiaryName} />
            <Review k="Banco" v={f.bankName} />
            {!intl ? (
              <>
                <Review k="Routing (ABA)" v={f.routingNumber} />
                <Review k="Conta" v={f.accountNumber} />
              </>
            ) : (
              <>
                <Review k="SWIFT/BIC" v={f.swift} />
                <Review k="Conta" v={f.accountNumber} />
                {f.iban && <Review k="IBAN" v={f.iban} />}
              </>
            )}
            <Review k="Tipo" v={f.accountType === "savings" ? "Poupança" : "Corrente"} />
          </div>

          <label className="mt-3 flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5">
            <input type="checkbox" name="attest" className="mt-0.5" />
            <span className="text-xs leading-relaxed text-slate-700">
              Confirmo que esta é a conta da <b>{entityName}</b> e autorizo a Vixus a enviar os pagamentos de
              distribuição para ela.
            </span>
          </label>

          <p className="mt-2 flex items-start gap-1.5 text-[11px] text-amber-700">
            <span>⚠</span>
            <span>Alterar qualquer dado depois exige confirmar de novo — e o pagamento fica travado até lá.</span>
          </p>

          {state?.error && <p className="mt-2 text-sm text-red-600">{state.error}</p>}

          <div className="mt-3 flex items-center justify-between">
            <button type="button" onClick={() => setMode("edit")} className="text-sm text-slate-500 hover:text-slate-700">
              ← Voltar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
            >
              {pending ? "Confirmando…" : "Confirmar conta de recebimento"}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function Review({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 border-t border-dashed border-slate-200 py-1.5 text-sm first:border-0">
      <span className="text-slate-500">{k}</span>
      <span className="font-medium tabular-nums text-slate-800">{v || "—"}</span>
    </div>
  );
}
