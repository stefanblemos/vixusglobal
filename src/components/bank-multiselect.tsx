"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { compareSimulationBanks } from "@/lib/actions/simulations";

export type BankOption = {
  id: string;
  name: string;
  loi: string | null; // ex.: "LOI #16804 · 2026-07-02" — banco com termos vindos de LOI
};

function CompareButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
    >
      {pending ? "Comparando…" : "⚖ Comparar"}
    </button>
  );
}

// Seleção de bancos p/ comparação: dropdown multiselect — os clicados persistem no topo
// da lista, na ordem em que foram escolhidos.
export function BankMultiSelect({
  simulationId,
  banks,
  initialSelected,
}: {
  simulationId: string;
  banks: BankOption[];
  initialSelected: string[];
}) {
  const [selected, setSelected] = useState<string[]>(
    initialSelected.filter((id) => banks.some((b) => b.id === id)),
  );
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const byId = new Map(banks.map((b) => [b.id, b]));
  // selecionados primeiro (na ordem do clique), depois os demais em ordem alfabética
  const ordered = [
    ...selected.map((id) => byId.get(id)!).filter(Boolean),
    ...banks.filter((b) => !selected.includes(b.id)),
  ];

  return (
    <form
      action={compareSimulationBanks}
      className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-4"
    >
      <input type="hidden" name="simulationId" value={simulationId} />
      {selected.map((id) => (
        <input key={id} type="hidden" name="bankIds" value={id} />
      ))}

      <div ref={boxRef} className="relative">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-64 flex-wrap items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm hover:border-slate-400"
        >
          {selected.length === 0 ? (
            <span className="text-slate-400">Escolha os bancos…</span>
          ) : (
            selected.map((id) => (
              <span
                key={id}
                onClick={(e) => {
                  e.stopPropagation();
                  toggle(id);
                }}
                className="inline-flex items-center gap-1 rounded-full bg-[#1f3a5f]/10 px-2 py-0.5 text-xs text-[#1f3a5f]"
                title="Clique para remover"
              >
                {byId.get(id)?.name}
                <span className="text-[#1f3a5f]/60">✕</span>
              </span>
            ))
          )}
          <span className="ml-auto pl-2 text-slate-400">▾</span>
        </button>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <div className="absolute z-20 mt-1 max-h-72 w-80 overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
              {ordered.map((b) => {
                const isSel = selected.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => toggle(b.id)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50 ${
                      isSel ? "bg-[#1f3a5f]/5 font-medium text-[#1f3a5f]" : "text-slate-700"
                    }`}
                  >
                    <span className={`w-4 text-center ${isSel ? "text-[#1f3a5f]" : "text-slate-200"}`}>
                      ✓
                    </span>
                    <span className="flex-1">{b.name}</span>
                    {b.loi && (
                      <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs text-emerald-700">
                        {b.loi}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      <CompareButton />
      <span className="text-xs text-slate-400">
        {selected.length > 0 ? `${selected.length} banco${selected.length > 1 ? "s" : ""} na comparação` : ""}
      </span>
    </form>
  );
}
