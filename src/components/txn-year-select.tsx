"use client";

import { useRouter } from "next/navigation";

// Select de ano para o ledger de transações — navega para ?txnYear=… (ou All).
export function TxnYearSelect({
  loanId,
  years,
  selected,
}: {
  loanId: string;
  years: number[];
  selected: number | null;
}) {
  const router = useRouter();
  return (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      Year
      <select
        value={selected == null ? "all" : String(selected)}
        onChange={(e) => {
          const v = e.target.value;
          router.push(
            v === "all"
              ? `/loans/${loanId}?tab=transactions`
              : `/loans/${loanId}?tab=transactions&txnYear=${v}`,
          );
        }}
        className="rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-[#1f3a5f] focus:ring-1 focus:ring-[#1f3a5f]"
      >
        <option value="all">All years</option>
        {years.map((y) => (
          <option key={y} value={String(y)}>
            {y}
          </option>
        ))}
      </select>
    </label>
  );
}
