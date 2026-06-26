"use client";

import { useRouter } from "next/navigation";

// Filtro de empresa em dropdown que navega ao trocar (sem botão "Ver"). Preserva os params
// extras (ano, aba). Valor "" = "Todas as empresas" (remove o param company).
export function CompanySelect({
  options,
  value,
  basePath,
  params,
}: {
  options: { value: string; label: string }[];
  value: string;
  basePath: string;
  params?: Record<string, string>;
}) {
  const router = useRouter();

  return (
    <select
      value={value}
      onChange={(e) => {
        const qs = new URLSearchParams({ ...(params ?? {}) });
        if (e.target.value) qs.set("company", e.target.value);
        else qs.delete("company");
        router.push(`${basePath}?${qs.toString()}`);
      }}
      className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-[#8DC63F] focus:ring-2 focus:ring-[#8DC63F]/30"
      aria-label="Empresa"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
