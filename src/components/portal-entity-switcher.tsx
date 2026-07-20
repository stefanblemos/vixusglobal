"use client";

import { useRouter } from "next/navigation";

// Seletor de entidade do portal (#68): multi-entidade — troca o escopo do dashboard.
// Com uma única entidade, mostra o nome sem dropdown.
export function PortalEntitySwitcher({
  entities,
  current,
}: {
  entities: Array<{ key: string; name: string }>;
  current?: string;
}) {
  const router = useRouter();
  if (entities.length === 0) return null;
  if (entities.length === 1) {
    return (
      <span className="flex items-center gap-1.5 text-slate-600">
        <span className="text-slate-400">🏦</span>
        {entities[0].name}
      </span>
    );
  }
  return (
    <select
      value={current ?? entities[0].key}
      onChange={(e) => router.push(`/portal?e=${encodeURIComponent(e.target.value)}`)}
      className="rounded-lg border border-slate-300 bg-white px-2 py-1 text-sm text-slate-700 outline-none focus:border-[#1f3a5f]"
    >
      {entities.map((en) => (
        <option key={en.key} value={en.key}>{en.name}</option>
      ))}
    </select>
  );
}
