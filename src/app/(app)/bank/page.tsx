import Link from "next/link";
import { prisma } from "@/lib/db";
import { BANK_ADAPTERS } from "@/lib/bank/adapters";
import { BankImportForm } from "@/components/bank-import-form";

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "—");

export default async function BankPage() {
  const statements = await prisma.bankStatement.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { company: true, _count: { select: { lines: true } } },
  });
  const banks = BANK_ADAPTERS.map((a) => ({ id: a.id, label: a.label }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Bank reconciliation</h1>
        <p className="text-sm text-slate-500">
          Upload a bank statement CSV and pick the bank — each bank has its own format adapter.
        </p>
      </div>

      <BankImportForm banks={banks} />

      <section className="space-y-3">
        <h2 className="text-lg font-medium text-slate-800">Recent statements</h2>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          {statements.length === 0 ? (
            <p className="p-6 text-sm text-slate-500">No statements yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-left text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">Company</th>
                  <th className="px-4 py-3 font-medium">Bank</th>
                  <th className="px-4 py-3 font-medium">Period</th>
                  <th className="px-4 py-3 text-right font-medium">Lines</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {statements.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link
                        href={`/bank/${s.id}`}
                        className="font-medium text-[#1f3a5f] hover:underline"
                      >
                        {s.company?.legalName ?? "—"}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{s.bankLabel}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {isoDate(s.periodStart)} → {isoDate(s.periodEnd)}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">{s._count.lines}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
