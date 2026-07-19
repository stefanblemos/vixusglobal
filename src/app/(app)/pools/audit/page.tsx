import Link from "next/link";
import { prisma } from "@/lib/db";

// Audit log do módulo Investments (#65) — trilha admin-facing de QUEM alterou o quê.
// Filtro opcional por pool via ?pool=<id>. Newest-first, últimos 300.
export const dynamic = "force-dynamic";

const ACTION_STYLE: Record<string, string> = {
  CREATE: "bg-emerald-50 text-emerald-700",
  UPDATE: "bg-blue-50 text-blue-700",
  DELETE: "bg-red-50 text-red-600",
  PUBLISH: "bg-violet-50 text-violet-700",
  ACCEPT: "bg-emerald-50 text-emerald-700",
  REJECT: "bg-red-50 text-red-600",
  PAYMENT: "bg-amber-50 text-amber-700",
};
const ENTITY_LABEL: Record<string, string> = {
  MEMBER: "Sócio",
  CONTRIBUTION: "Aporte",
  TRANSFER: "Transferência",
  DISTRIBUTION: "Distribuição",
  CAPITAL_CALL: "Capital call",
  SUBSCRIPTION: "Subscrição",
  REPORT: "Report",
  HOUSE: "Casa",
  POOL: "Pool",
};

export default async function AuditLogPage({
  searchParams,
}: {
  searchParams: Promise<{ pool?: string }>;
}) {
  const { pool: poolFilter } = await searchParams;
  const [rows, pools] = await Promise.all([
    prisma.investmentAudit.findMany({
      where: poolFilter ? { poolId: poolFilter } : undefined,
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.investmentPool.findMany({ select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  const poolById = new Map(pools.map((p) => [p.id, p]));
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(d);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Audit log</h1>
          <p className="text-sm text-slate-500">
            Trilha de alterações sensíveis do módulo Investments — quem fez o quê e quando.
          </p>
        </div>
        <Link href="/pools" className="text-sm text-slate-500 hover:text-slate-800">
          ← Pools
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        <Link
          href="/pools/audit"
          className={`rounded-full px-3 py-1 text-xs font-semibold ${!poolFilter ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
        >
          Todos os pools
        </Link>
        {pools.map((p) => (
          <Link
            key={p.id}
            href={`/pools/audit?pool=${p.id}`}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${poolFilter === p.id ? "bg-[#1f3a5f] text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
          >
            {p.code}
          </Link>
        ))}
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
              <th className="px-4 py-2.5 font-medium">Quando</th>
              <th className="px-3 py-2.5 font-medium">Pool</th>
              <th className="px-3 py-2.5 font-medium">Tipo</th>
              <th className="px-3 py-2.5 font-medium">Ação</th>
              <th className="px-3 py-2.5 font-medium">Detalhe</th>
              <th className="px-4 py-2.5 font-medium">Por</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-400">
                  Nenhuma alteração registrada ainda.
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const p = r.poolId ? poolById.get(r.poolId) : null;
                return (
                  <tr key={r.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs tabular-nums text-slate-500">{fmt(r.createdAt)}</td>
                    <td className="px-3 py-2.5 text-xs font-medium text-slate-700">
                      {p ? (
                        <Link href={`/pools/${p.id}`} className="hover:underline">{p.code}</Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-500">{ENTITY_LABEL[r.entity] ?? r.entity}</td>
                    <td className="px-3 py-2.5">
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${ACTION_STYLE[r.action] ?? "bg-slate-100 text-slate-600"}`}>
                        {r.action}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-xs text-slate-700">{r.summary}</td>
                    <td className="whitespace-nowrap px-4 py-2.5 text-xs text-slate-500">{r.changedBy}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      {rows.length === 300 && (
        <p className="mt-2 text-[11px] text-slate-400">Mostrando os 300 registros mais recentes.</p>
      )}
    </div>
  );
}
