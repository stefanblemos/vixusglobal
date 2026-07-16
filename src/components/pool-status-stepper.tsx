"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setPoolStatus } from "@/lib/actions/pools";

// Stepper da vida do pool (mock UX 3/6): Funding → Active → Closing → Closed.
// Clicar muda o status na hora — mesmo padrão do stepper da ficha da casa.

const STEPS: Array<{ value: string; label: string }> = [
  { value: "FUNDING", label: "Funding" },
  { value: "ACTIVE", label: "Active" },
  { value: "CLOSING", label: "Closing" },
  { value: "CLOSED", label: "Closed" },
];

export function PoolStatusStepper({
  poolId,
  status,
  subtitles,
}: {
  poolId: string;
  status: string;
  subtitles: Record<string, string>; // por passo: "desde 27/10/2025 · 74% captado" etc.
}) {
  const [local, setLocal] = useState(status);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const idx = STEPS.findIndex((s) => s.value === local);

  const stepTo = (value: string) => {
    setLocal(value);
    startTransition(async () => {
      await setPoolStatus(poolId, value);
      router.refresh();
    });
  };

  return (
    <div className="flex gap-1">
      {STEPS.map((s, i) => (
        <button
          key={s.value}
          type="button"
          onClick={() => stepTo(s.value)}
          disabled={pending}
          className={`flex-1 rounded-md px-2 py-2 text-[11px] transition ${
            i === idx
              ? "bg-[#1f3a5f] font-bold text-white"
              : i < idx
                ? "bg-emerald-100 font-semibold text-emerald-700 hover:bg-emerald-200"
                : "bg-slate-100 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
          }`}
        >
          {s.label}
          {subtitles[s.value] && (
            <span className={`mt-0.5 block text-[9.5px] font-normal ${i === idx ? "text-slate-200" : ""}`}>
              {subtitles[s.value]}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
