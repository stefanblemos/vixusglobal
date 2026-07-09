"use client";

import { usePathname, useRouter } from "next/navigation";

// Filtro All/mensal do loan statement — os meses são gerados do primeiro lançamento até o
// mês corrente (auto-incremental conforme o tempo passa).
export function LoanMonthFilter({ months, value }: { months: string[]; value: string }) {
  const router = useRouter();
  const pathname = usePathname();
  return (
    <select
      value={value}
      onChange={(e) => router.push(`${pathname}?month=${e.target.value}`)}
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
