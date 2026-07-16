import Link from "next/link";

// Navegação em abas do pool — compartilhada entre a página do pool (?tab=) e a página do
// loan statement (rota própria /pools/[id]/loan, exibida como aba).
const TABS: Array<{ key: string; label: string; href: (poolId: string) => string }> = [
  { key: "overview", label: "Overview", href: (id) => `/pools/${id}?tab=overview` },
  { key: "houses", label: "Casas", href: (id) => `/pools/${id}?tab=houses` },
  { key: "schedule", label: "Cronograma", href: (id) => `/pools/${id}/schedule` },
  { key: "investors", label: "Investidores", href: (id) => `/pools/${id}?tab=investors` },
  { key: "interest", label: "Juros & reserve", href: (id) => `/pools/${id}?tab=interest` },
  { key: "ledger", label: "Capital ledger", href: (id) => `/pools/${id}?tab=ledger` },
  { key: "provision", label: "Provisão", href: (id) => `/pools/${id}/provision` },
  { key: "loan", label: "Loan statement", href: (id) => `/pools/${id}/loan` },
  { key: "distributions", label: "Distribuições", href: (id) => `/pools/${id}?tab=distributions` },
];

export function PoolTabsNav({ poolId, active }: { poolId: string; active: string }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-slate-200">
      {TABS.map((t) => (
        <Link
          key={t.key}
          href={t.href(poolId)}
          className={`whitespace-nowrap rounded-t-lg border-b-2 px-4 py-2 text-sm transition ${
            active === t.key
              ? "border-[#1f3a5f] font-medium text-[#1f3a5f]"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
