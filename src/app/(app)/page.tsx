import Link from "next/link";
import { prisma } from "@/lib/db";

export default async function DashboardPage() {
  const [companies, parties, loans] = await Promise.all([
    prisma.company.count(),
    prisma.party.count(),
    prisma.intercompanyLoan.count(),
  ]);

  const cards = [
    { label: "Empresas", value: companies, href: "/companies" },
    { label: "Donos", value: parties, href: "/parties" },
    { label: "Empréstimos", value: loans, href: "/companies" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Dashboard</h1>
        <p className="text-sm text-slate-500">Visão geral da plataforma Vixus Global.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {cards.map((c) => (
          <Link
            key={c.label}
            href={c.href}
            className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-[#8DC63F]"
          >
            <div className="text-sm text-slate-500">{c.label}</div>
            <div className="mt-2 text-3xl font-semibold text-slate-800">{c.value}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
