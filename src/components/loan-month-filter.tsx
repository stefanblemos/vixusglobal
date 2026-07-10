"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

// Filtro All/mensal do loan statement — os meses são gerados do primeiro lançamento até o
// mês corrente (auto-incremental conforme o tempo passa). Preserva os demais params (?loan=).
export function LoanMonthFilter({ months, value }: { months: string[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  return (
    <select
      value={value}
      onChange={(e) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("month", e.target.value);
        router.push(`${pathname}?${params.toString()}`);
      }}
      className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f]"
    >
      <option value="all">Todos os meses</option>
      {months.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
    </select>
  );
}
