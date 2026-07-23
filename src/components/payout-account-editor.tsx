"use client";

import { useState, useTransition } from "react";
import { savePayoutAccountByMember, type PayoutFormState } from "@/lib/actions/payout";

// #69 — editor da conta de recebimento pelo OPERADOR (fallback telefone/papel). Salvar sempre
// deixa a conta como "Pendente" quando a instrução muda — só o sócio confirma no portal.

export type OperatorPayout = {
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

const CHIP: Record<OperatorPayout["status"], { label: string; cls: string }> = {
  CONFIRMED: { label: "Conta ✓", cls: "bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-emerald-200" },
  PENDING: { label: "Conta ⏳", cls: "bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200" },
  NONE: { label: "+ conta", cls: "bg-slate-50 text-slate-500 hover:bg-slate-100 border-slate-200" },
};

const inp =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const lbl = "mb-1 block text-xs font-medium text-slate-500";

export function PayoutAccountEditor({
  memberId,
  memberName,
  payout,
}: {
  memberId: string;
  memberName: string;
  payout: OperatorPayout;
}) {
  const [open, setOpen] = useState(false);
  const [intl, setIntl] = useState(Boolean(payout.swift || payout.iban));
  const [pending, start] = useTransition();
  const [state, setState] = useState<PayoutFormState>(undefined);

  // fecha ao salvar com sucesso (setState no callback da transição, não em effect)
  const action = (fd: FormData) =>
    start(async () => {
      const res = await savePayoutAccountByMember(memberId, undefined, fd);
      setState(res);
      if (res?.ok) setOpen(false);
    });

  const chip = CHIP[payout.status];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`rounded-md border px-2 py-0.5 text-[11px] font-medium ${chip.cls}`}
        title="Conta de recebimento das distribuições"
      >
        {chip.label}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="border-b border-slate-100 px-5 py-4">
              <h3 className="text-sm font-bold text-slate-800">Conta de recebimento</h3>
              <p className="mt-0.5 text-xs text-slate-400">{memberName}</p>
            </div>

            <form action={action} className="px-5 py-4">
              {payout.status === "CONFIRMED" && (
                <div className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800">
                  Esta conta já foi <b>confirmada pelo sócio</b>. Se você alterar qualquer dado bancário,
                  ela volta para <b>pendente</b> e precisa ser confirmada de novo no portal.
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <label className={lbl}>Titular da conta (beneficiário)</label>
                  <input name="beneficiaryName" defaultValue={payout.beneficiaryName || memberName} required className={inp} />
                </div>
                <div>
                  <label className={lbl}>Banco</label>
                  <input name="bankName" defaultValue={payout.bankName} required className={inp} />
                </div>
                {!intl ? (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className={lbl}>Routing (ABA)</label>
                      <input name="routingNumber" defaultValue={payout.routingNumber ?? ""} className={inp} inputMode="numeric" />
                    </div>
                    <div>
                      <label className={lbl}>Nº da conta</label>
                      <input name="accountNumber" defaultValue={payout.accountNumber} className={inp} />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className={lbl}>SWIFT/BIC</label>
                        <input name="swift" defaultValue={payout.swift ?? ""} className={inp} />
                      </div>
                      <div>
                        <label className={lbl}>Nº da conta</label>
                        <input name="accountNumber" defaultValue={payout.accountNumber} className={inp} />
                      </div>
                    </div>
                    <div>
                      <label className={lbl}>IBAN (se houver)</label>
                      <input name="iban" defaultValue={payout.iban ?? ""} className={inp} />
                    </div>
                    <div>
                      <label className={lbl}>Endereço do banco</label>
                      <input name="bankAddress" defaultValue={payout.bankAddress ?? ""} className={inp} />
                    </div>
                  </>
                )}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className={lbl}>Tipo</label>
                    <select name="accountType" defaultValue={payout.accountType ?? "checking"} className={inp}>
                      <option value="checking">Corrente (checking)</option>
                      <option value="savings">Poupança (savings)</option>
                    </select>
                  </div>
                  <label className="flex items-end gap-2 pb-2 text-xs text-slate-500">
                    <input type="checkbox" checked={intl} onChange={(e) => setIntl(e.target.checked)} />
                    Conta internacional
                  </label>
                </div>
                {/* preserva os campos do outro modo quando escondidos */}
                {!intl && <input type="hidden" name="swift" value={payout.swift ?? ""} />}
                {!intl && <input type="hidden" name="iban" value={payout.iban ?? ""} />}
                {!intl && <input type="hidden" name="bankAddress" value={payout.bankAddress ?? ""} />}
                {intl && <input type="hidden" name="routingNumber" value={payout.routingNumber ?? ""} />}
              </div>

              {state?.error && <p className="mt-3 text-sm text-red-600">{state.error}</p>}

              <div className="mt-4 flex items-center justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-2 text-sm text-slate-500 hover:bg-slate-50">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
                >
                  {pending ? "Salvando…" : "Salvar conta"}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
                A confirmação que libera o pagamento é feita pelo próprio sócio no portal. O operador só
                registra os dados (ex.: recebidos por telefone).
              </p>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
