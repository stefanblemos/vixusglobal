"use client";

import { useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { setGlobalYear } from "@/lib/actions/year";

// Seletor de ano GLOBAL na sidebar: grava o cookie e recarrega — todas as telas fiscais passam a usar
// esse ano como padrão. A URL (?year) de cada página ainda vence como override pontual.
export function GlobalYear({ year, years }: { year: number; years: number[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  return (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      <span className="shrink-0">Year</span>
      <select
        value={year}
        disabled={pending}
        onChange={(e) => {
          const y = Number(e.target.value);
          startTransition(async () => {
            await setGlobalYear(y);
            router.replace(pathname); // drop ?year (per-page override) so the global cookie wins
            router.refresh(); // re-render server components with the new cookie
          });
        }}
        className="w-full rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700 hover:border-slate-300 focus:outline-none focus:ring-1 focus:ring-[#1f3a5f] disabled:opacity-60"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  );
}
