"use client";

import { useRouter } from "next/navigation";

// Filtro de ano em dropdown (escala melhor que uma fileira de botões). Navega ao
// trocar, preservando os params extras (ex.: a aba) + year.
export function YearSelect({
  years,
  value,
  basePath,
  params,
}: {
  years: number[];
  value: number;
  basePath: string;
  params?: Record<string, string>;
}) {
  const router = useRouter();

  return (
    <select
      value={value}
      onChange={(e) => {
        const qs = new URLSearchParams({ ...(params ?? {}), year: e.target.value });
        router.push(`${basePath}?${qs.toString()}`);
      }}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30"
      aria-label="Year"
    >
      {years.map((y) => (
        <option key={y} value={y}>
          {y}
        </option>
      ))}
    </select>
  );
}
