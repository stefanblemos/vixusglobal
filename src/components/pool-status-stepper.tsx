// Stepper da vida do pool (16/07): INDICADOR derivado dos fatos — não é mais clicável.
// Gatilhos: Active = 1ª casa com lote; Closing = todas vendidas; Closed = loans quitados +
// lucro distribuído + caixa devolvido. Subtítulos trazem o x/x das casas (pedido B).

const STEPS: Array<{ value: string; label: string }> = [
  { value: "FUNDING", label: "Funding" },
  { value: "ACTIVE", label: "Active" },
  { value: "CLOSING", label: "Closing" },
  { value: "CLOSED", label: "Closed" },
];

export function PoolStatusStepper({
  status,
  subtitles,
}: {
  status: string;
  subtitles: Record<string, string>;
}) {
  const idx = STEPS.findIndex((s) => s.value === status);
  return (
    <div className="flex gap-1" title="Fases derivadas automaticamente das atividades — lote pago, vendas, quitação e distribuições">
      {STEPS.map((s, i) => (
        <div
          key={s.value}
          className={`flex-1 rounded-md px-2 py-2 text-center text-[11px] ${
            i === idx
              ? "bg-[#1f3a5f] font-bold text-white"
              : i < idx
                ? "bg-emerald-100 font-semibold text-emerald-700"
                : "bg-slate-100 text-slate-400"
          }`}
        >
          {s.label}
          {subtitles[s.value] && (
            <span className={`mt-0.5 block text-[9.5px] font-normal ${i === idx ? "text-slate-200" : ""}`}>
              {subtitles[s.value]}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
