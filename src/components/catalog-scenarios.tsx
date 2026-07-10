"use client";

import { useEffect, useState } from "react";
import { useActionState } from "react";
import { deleteScenario, saveScenario, type CatalogFormState } from "@/lib/actions/catalog";
import type { HistoryEntry } from "@/components/catalog-locations";

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const th = "px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400";
const td = "px-3 py-2.5 text-sm text-slate-600";

export type ScenarioRow = {
  code: string;
  name: string;
  salePriceBufferPct: string;
  constructionCostBufferPct: string;
  lotCostBufferPct: string;
  closingFeePct: string;
  contingencyReservePct: string;
  landAcquisitionDays: string;
  constructionDurationBufferM: string;
  salesAbsorptionMonths: string | null;
  emdPct: string;
  stressSlippagePct: string;
  sortOrder: string;
};

const CORE = new Set(["OPT", "REAL", "CONS"]);

// Campos agrupados pelo "dono" do processo, com explicação para o operador.
const GROUPS: Array<{
  title: string;
  hint: string;
  fields: Array<{ name: keyof ScenarioRow; label: string; hint: string }>;
}> = [
  {
    title: "Lote",
    hint: "Tudo que afeta a compra do terreno.",
    fields: [
      { name: "lotCostBufferPct", label: "Custo do lote %", hint: "Ajuste sobre o valor estimado do lote (+5 = lote 5% mais caro)" },
      { name: "landAcquisitionDays", label: "Atraso de compra (dias)", hint: "Dias extras até fechar o lote, além do prazo do location" },
      { name: "emdPct", label: "EMD %", hint: "Sinal (earnest money) pago na oferta do lote" },
    ],
  },
  {
    title: "Obra",
    hint: "Tudo que afeta custo e prazo de construção.",
    fields: [
      { name: "constructionCostBufferPct", label: "Custo de obra %", hint: "Ajuste sobre o custo do catálogo (+10 = obra 10% mais cara)" },
      { name: "constructionDurationBufferM", label: "Prazo de obra (± meses)", hint: "Meses somados/subtraídos da duração do modelo" },
      { name: "contingencyReservePct", label: "Contingência %", hint: "Reserva sobre (lote + obra), devolvida se não usada" },
    ],
  },
  {
    title: "Venda & closing",
    hint: "Tudo que afeta o preço e o tempo de venda.",
    fields: [
      { name: "salePriceBufferPct", label: "Preço de venda %", hint: "Ajuste sobre a venda do catálogo (−7 = vende 7% mais barato)" },
      { name: "salesAbsorptionMonths", label: "Absorção (meses)", hint: "Meses até vender após o CO; vazio = usa os dias do location" },
      { name: "closingFeePct", label: "Closing fee %", hint: "Comissões e custos de venda, % do preço de venda" },
    ],
  },
  {
    title: "Outros",
    hint: "Stress e organização.",
    fields: [
      { name: "stressSlippagePct", label: "Slippage %", hint: "Derrapagem extra sobre o custo total (modo stress)" },
      { name: "sortOrder", label: "Ordem", hint: "Posição na lista de cenários" },
    ],
  },
];

function ScenarioModal({
  scenario,
  history,
  onClose,
}: {
  scenario: ScenarioRow | null; // null = novo cenário custom
  history: HistoryEntry[];
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState<CatalogFormState, FormData>(
    saveScenario,
    undefined,
  );
  useEffect(() => {
    if (state?.ok) onClose();
  }, [state, onClose]);

  const isCore = scenario ? CORE.has(scenario.code) : false;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-6"
      onClick={onClose}
    >
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <h3 className="text-lg font-semibold text-slate-800">
            {scenario ? `${scenario.name} (${scenario.code})` : "New custom scenario"}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {/* key = valores atuais: quando o save devolve dados novos, o form REMONTA e os
            inputs releem o defaultValue — sem isso o form reset do React 19 deixava a
            tela com os valores antigos (parecia que o save não persistia) */}
        <form key={JSON.stringify(scenario)} action={formAction} className="space-y-5 px-6 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Code *</label>
              {scenario ? (
                <>
                  <input type="hidden" name="code" value={scenario.code} />
                  <input value={scenario.code} readOnly className={`${inputClass} bg-slate-50 text-slate-400`} />
                </>
              ) : (
                <input name="code" required placeholder="ex.: STRESS" className={inputClass} />
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">Name</label>
              <input name="name" defaultValue={scenario?.name ?? ""} className={inputClass} />
            </div>
          </div>

          {GROUPS.map((g) => (
            <div key={g.title}>
              <h4 className="text-sm font-semibold text-slate-700">{g.title}</h4>
              <p className="mb-2 text-xs text-slate-400">{g.hint}</p>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                {g.fields.map((f) => (
                  <div key={f.name}>
                    <label className="mb-1 block text-sm font-medium text-slate-700">{f.label}</label>
                    <input
                      name={f.name}
                      defaultValue={(scenario?.[f.name] as string | null) ?? ""}
                      className={inputClass}
                    />
                    <p className="mt-1 text-[11px] leading-snug text-slate-400">{f.hint}</p>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {state?.error && <p className="text-sm text-red-600">{state.error}</p>}

          <div className="flex items-center justify-between pt-1">
            {scenario && !isCore ? (
              <button
                type="submit"
                formAction={deleteScenario}
                className="rounded-lg border border-red-200 px-3 py-2 text-sm text-red-500 hover:bg-red-50"
              >
                Delete scenario
              </button>
            ) : (
              <span className="text-xs text-slate-400">
                {isCore ? "Cenário padrão do sistema — não pode ser apagado." : ""}
              </span>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={pending}
                className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
              >
                {pending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </form>

        {scenario && (
          <div className="border-t border-slate-100 px-6 py-4">
            <h4 className="mb-2 text-sm font-semibold text-slate-700">Change history</h4>
            {history.length === 0 ? (
              <p className="text-xs text-slate-400">No changes recorded yet.</p>
            ) : (
              <div className="max-h-48 space-y-2 overflow-y-auto pr-2">
                {history.map((h, i) => (
                  <div key={i} className="rounded-lg bg-slate-50 px-3 py-2 text-xs">
                    <div className="flex justify-between text-slate-400">
                      <span>
                        {h.action === "CREATE" ? "Created" : h.action === "DELETE" ? "Deleted" : "Updated"} by{" "}
                        <span className="font-medium text-slate-600">{h.changedBy}</span>
                      </span>
                      <span>{new Date(h.createdAt).toLocaleString("en-US")}</span>
                    </div>
                    {h.changes.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-slate-600">
                        {h.changes.map((c, j) => (
                          <li key={j}>
                            {c.field}: <span className="text-slate-400 line-through">{c.from ?? "—"}</span> →{" "}
                            <span className="font-medium">{c.to ?? "—"}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export function CatalogScenarios({
  scenarios,
  history,
}: {
  scenarios: ScenarioRow[];
  history: HistoryEntry[];
}) {
  const [selected, setSelected] = useState<string | "new" | null>(null);
  const current = selected === "new" ? null : scenarios.find((s) => s.code === selected) ?? null;

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="text-base font-medium text-slate-800">Buffer scenarios</h2>
          <p className="text-xs text-slate-400">
            Buffers applied on top of catalog values, grouped by lot, construction and sale.
            Click a row to edit — changes are logged.
          </p>
        </div>
        <button
          onClick={() => setSelected("new")}
          className="rounded-lg bg-[#1f3a5f] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#16304f]"
        >
          + Custom scenario
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100">
              <th className={th}>Scenario</th>
              <th className={th}>Lote % / dias</th>
              <th className={th}>Obra % / ±m</th>
              <th className={th}>Venda % / abs.</th>
              <th className={th}>Closing %</th>
              <th className={th}>Contingência %</th>
              <th className={th}>EMD %</th>
            </tr>
          </thead>
          <tbody>
            {scenarios.map((s) => (
              <tr
                key={s.code}
                onClick={() => setSelected(s.code)}
                className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/70"
              >
                <td className={`${td} font-medium text-slate-800`}>
                  {s.name} <span className="text-xs font-normal text-slate-400">({s.code})</span>
                </td>
                <td className={td}>
                  {s.lotCostBufferPct}% · {s.landAcquisitionDays}d
                </td>
                <td className={td}>
                  {s.constructionCostBufferPct}% · {Number(s.constructionDurationBufferM) >= 0 ? "+" : ""}
                  {s.constructionDurationBufferM}m
                </td>
                <td className={td}>
                  {s.salePriceBufferPct}% · {s.salesAbsorptionMonths ?? "—"}m
                </td>
                <td className={td}>{s.closingFeePct}%</td>
                <td className={td}>{s.contingencyReservePct}%</td>
                <td className={td}>{s.emdPct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {selected !== null && (
        <ScenarioModal
          scenario={current}
          history={history.filter((h) => current && h.entityId === current.code)}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
