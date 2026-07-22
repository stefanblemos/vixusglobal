"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { resolveTaxReturnUpload, type AmendState } from "@/lib/actions/ir";

/**
 * IR já existe para esta empresa/ano — o que fazer? (modal do upload)
 *
 * Três saídas, porque duas declarações no mesmo ano PODEM ser legítimas (períodos curtos de
 * conversão, ex.: 1120-S final + 1065). Por isso a retificação é declarada, nunca inferida.
 *
 * Regra que a tela deixa explícita: o IR NÃO altera os livros (QBO). Se a retificadora mudou
 * a depreciação, isso vira diferença na Conferência e o ajuste é MANUAL no cadastro de ativos.
 */

export type ConflictReturn = {
  id: string;
  fileName: string;
  taxForm: string | null;
  netIncome: number | null;
  createdAt: string;
};

const money = (n: number | null) =>
  n == null ? "—" : "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Mode = "AMENDMENT" | "SEPARATE" | "DUPLICATE";

export function IrAmendmentModal({
  newId,
  newFileName,
  conflicts,
  onDone,
}: {
  newId: string;
  newFileName: string;
  conflicts: ConflictReturn[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("AMENDMENT");
  const [oldId, setOldId] = useState(conflicts[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [state, setState] = useState<AmendState>(undefined);

  const submit = () => {
    const fd = new FormData();
    fd.set("newId", newId);
    fd.set("mode", mode);
    fd.set("oldId", oldId);
    fd.set("note", note);
    start(async () => {
      const r = await resolveTaxReturnUpload(undefined, fd);
      setState(r);
      if (r?.ok) {
        router.refresh();
        if (mode !== "AMENDMENT") onDone(); // na retificação, deixa a mensagem visível
      }
    });
  };

  const opt = (m: Mode, title: string, desc: string) => (
    <label
      key={m}
      className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${
        mode === m ? "border-[#1f3a5f] bg-[#f6f8fb]" : "border-slate-200 hover:bg-slate-50"
      }`}
    >
      <input type="radio" name="mode" checked={mode === m} onChange={() => setMode(m)} className="mt-0.5 accent-[#1f3a5f]" />
      <span>
        <span className="block text-sm font-semibold text-slate-800">{title}</span>
        <span className="block text-xs leading-relaxed text-slate-500">{desc}</span>
      </span>
    </label>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
        <h3 className="text-base font-semibold text-slate-800">Já existe declaração para esta empresa e ano</h3>
        <p className="mt-1 text-xs text-slate-500">
          O que você acabou de subir: <b>{newFileName}</b>. Escolha o que fazer.
        </p>

        <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500">Já cadastrada(s)</p>
          {conflicts.map((c) => (
            <label key={c.id} className="flex items-center gap-2 py-1 text-sm">
              {conflicts.length > 1 && (
                <input type="radio" checked={oldId === c.id} onChange={() => setOldId(c.id)} className="accent-[#1f3a5f]" />
              )}
              <span className="flex-1 truncate text-slate-700">{c.fileName}</span>
              <span className="text-[11px] text-slate-400">{c.taxForm ?? "—"}</span>
              <span className="tabular-nums text-slate-600">{money(c.netIncome)}</span>
              <span className="text-[11px] text-slate-400">{c.createdAt}</span>
            </label>
          ))}
        </div>

        <div className="mt-4 space-y-2">
          {opt(
            "AMENDMENT",
            "É a retificadora — substitui a anterior",
            "A nova passa a valer em todos os cálculos (Conferência, M-1, depreciação, K-1). A anterior fica arquivada no histórico, com o PDF preservado — foi o que se protocolou.",
          )}
          {opt(
            "SEPARATE",
            "São declarações diferentes do mesmo ano",
            "Ex.: conversão de tipo no meio do ano — 1120-S do período curto + 1065 do restante. As duas continuam valendo e se somam no ano.",
          )}
          {opt("DUPLICATE", "Foi engano — descartar este upload", "Apaga o que acabou de subir. Nada muda.")}
        </div>

        {mode === "AMENDMENT" && (
          <>
            <div className="mt-3">
              <label className="mb-1 block text-[11px] font-medium text-slate-500">Motivo da retificação (opcional)</label>
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="ex.: revisão do contador — depreciação e resultado"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20"
              />
            </div>
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] leading-relaxed text-amber-900">
              ⚠ Isto <b>não altera os livros</b>. O IR é base de comparação — se a depreciação mudou, a diferença vai
              aparecer na Conferência e o ajuste nos ativos/livros precisa ser feito <b>manualmente</b>.
            </p>
          </>
        )}

        {state?.ok && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">✓ {state.message}</p>}
        {state?.error && <p className="mt-3 text-sm text-red-600">{state.error}</p>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button type="button" onClick={onDone} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">
            {state?.ok ? "Fechar" : "Decidir depois"}
          </button>
          {!state?.ok && (
            <button
              type="button"
              onClick={submit}
              disabled={pending || (mode === "AMENDMENT" && !oldId)}
              className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-50"
            >
              {pending ? "Aplicando…" : "Confirmar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
