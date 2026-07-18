import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { memberName } from "@/lib/pools/math";
import { buildActivityFeed } from "@/lib/pools/activity-feed";

export const dynamic = "force-dynamic";

// Atividade completa do pool (layout novo 18/07): o Overview mostra só os últimos 6
// eventos — o feed inteiro mora aqui, na rota própria. Mesma fonte (activity-feed.ts).
export default async function PoolActivityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const pool = await prisma.investmentPool.findUnique({
    where: { id },
    include: {
      houses: true,
      members: { include: { entries: true, party: true, company: true } },
      distributions: { orderBy: { date: "asc" }, include: { lines: true } },
      expenses: { orderBy: { date: "asc" } },
      loans: {
        orderBy: { createdAt: "asc" },
        include: {
          bankProfile: { select: { name: true } },
          entries: { orderBy: [{ date: "asc" }, { createdAt: "asc" }] },
          documents: { select: { kind: true, fileName: true, createdAt: true } },
        },
      },
    },
  });
  if (!pool) notFound();

  const houseAddrById = new Map(pool.houses.map((h) => [h.id, h.address]));
  const feed = buildActivityFeed(
    {
      members: pool.members.map((m) => ({
        name: memberName(m),
        entries: m.entries.map((e) => ({ kind: e.kind, date: e.date, amount: e.amount })),
      })),
      loans: pool.loans.map((l) => ({
        bankName: l.bankProfile?.name ?? null,
        entries: l.entries.map((e) => ({
          type: e.type,
          date: e.date,
          amount: e.amount,
          pending: e.pending,
          houseAddress: e.houseId ? (houseAddrById.get(e.houseId) ?? null) : null,
        })),
        documents: l.documents,
      })),
      houses: pool.houses,
      distributions: pool.distributions.map((d) => ({
        date: d.date,
        amount: d.lines.reduce((s, l) => s + Number(l.amount), 0),
      })),
      expenses: pool.expenses,
      currency: pool.currency,
    },
    1000,
  );

  // agrupamento por mês (MM/YYYY) — leitura de timeline longa fica navegável
  const groups: Array<{ key: string; label: string; events: typeof feed.events }> = [];
  for (const e of feed.events) {
    const key = `${e.date.getUTCFullYear()}-${String(e.date.getUTCMonth() + 1).padStart(2, "0")}`;
    const label = `${String(e.date.getUTCMonth() + 1).padStart(2, "0")}/${e.date.getUTCFullYear()}`;
    const g = groups[groups.length - 1];
    if (g && g.key === key) g.events.push(e);
    else groups.push({ key, label, events: [e] });
  }

  return (
    <div className="max-w-3xl space-y-5">
      <div>
        <Link href={`/pools/${pool.id}`} className="text-sm text-slate-500 hover:text-slate-700">
          ← {pool.code} · Overview
        </Link>
        <h1 className="mt-1 text-2xl font-semibold text-slate-800">Atividade do pool</h1>
        <p className="text-sm text-slate-500">
          {feed.total} eventos derivados dos lançamentos e datas — a narrativa do report mensal
          nasce daqui.
        </p>
      </div>

      {groups.map((g) => (
        <section key={g.key} className="rounded-xl border border-slate-200 bg-white px-5 py-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]">
            {g.label}
          </h2>
          <div className="space-y-0">
            {g.events.map((e, i) => (
              <div
                key={`${e.date.toISOString()}-${i}`}
                className="flex items-baseline gap-3 border-l-2 border-slate-100 py-1.5 pl-4"
              >
                <span className="w-20 shrink-0 text-[11px] tabular-nums text-slate-400">
                  {`${String(e.date.getUTCMonth() + 1).padStart(2, "0")}/${String(e.date.getUTCDate()).padStart(2, "0")}/${e.date.getUTCFullYear()}`}
                </span>
                <span className="shrink-0 text-sm">{e.icon}</span>
                <span className="text-sm text-slate-700">{e.text}</span>
              </div>
            ))}
          </div>
        </section>
      ))}
      {feed.total === 0 && (
        <p className="text-sm text-slate-400">Nenhum evento registrado ainda.</p>
      )}
    </div>
  );
}
