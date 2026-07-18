import Link from "next/link";

// Navegação em abas do pool — compartilhada entre a página do pool (?tab=) e a página do
// loan statement (rota própria /pools/[id]/loan, exibida como aba).
// Layout novo (mock aprovado 18/07): 6 abas — Financiamento = ex-Loan statement;
// Investidores absorve Capital ledger e Distribuições como sub-abas.
const TABS: Array<{ key: string; label: string; href: (poolId: string) => string }> = [
  { key: "overview", label: "Overview", href: (id) => `/pools/${id}?tab=overview` },
  { key: "houses", label: "Casas", href: (id) => `/pools/${id}?tab=houses` },
  { key: "schedule", label: "Cronograma", href: (id) => `/pools/${id}/schedule` },
  { key: "loan", label: "Financiamento", href: (id) => `/pools/${id}/loan` },
  { key: "investors", label: "Investidores", href: (id) => `/pools/${id}?tab=investors` },
  { key: "provision", label: "Provisão & risco", href: (id) => `/pools/${id}/provision` },
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
