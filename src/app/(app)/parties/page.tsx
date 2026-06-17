import Link from "next/link";
import { prisma } from "@/lib/db";
import { labelForJurisdiction, labelForPartyKind } from "@/lib/catalog";
import { looseNameMatch } from "@/lib/personal/reconcile";
import { MergeOwnerButton } from "@/components/merge-owner-button";

export const dynamic = "force-dynamic";

const ssn4 = (v: string | null | undefined) => (v ?? "").replace(/\D/g, "").slice(-4);

export default async function PartiesPage() {
  const [parties, personalReturns] = await Promise.all([
    prisma.party.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { personalReturns: true, ownerStakes: true } } },
    }),
    prisma.personalReturn.findMany({
      select: { matchedName: true, ssnLast4: true, spouseName: true, spouseSsnLast4: true },
    }),
  ]);

  // SSN (4 últimos) de cada dono — do próprio Tax ID e dos 1040 (contribuinte/cônjuge),
  // casando o nome com tolerância à truncagem do IRS.
  const partySsn = new Map<string, Set<string>>();
  const addSsn = (id: string, ssn: string | null | undefined) => {
    const d = ssn4(ssn);
    if (d.length !== 4) return;
    const s = partySsn.get(id) ?? new Set<string>();
    s.add(d);
    partySsn.set(id, s);
  };
  for (const p of parties) addSsn(p.id, p.taxId);
  for (const r of personalReturns) {
    for (const p of parties) {
      if (r.matchedName && looseNameMatch(r.matchedName, p.name)) addSsn(p.id, r.ssnLast4);
      if (r.spouseName && looseNameMatch(r.spouseName, p.name)) addSsn(p.id, r.spouseSsnLast4);
    }
  }

  // Detecta donos duplicados: mesmo SSN (confiável) OU nome parecido sem SSN conflitante
  // (precisa confirmar). Mantém o que tem mais vínculos; o outro é mesclado nele.
  const persons = parties.filter((p) => p.kind === "PERSON");
  const score = (p: (typeof persons)[number]) =>
    p._count.ownerStakes + p._count.personalReturns;
  const dups: { keep: (typeof persons)[number]; drop: (typeof persons)[number]; reason: "ssn" | "name" }[] = [];
  for (let i = 0; i < persons.length; i++) {
    for (let j = i + 1; j < persons.length; j++) {
      const a = persons[i];
      const b = persons[j];
      const sa = partySsn.get(a.id) ?? new Set<string>();
      const sb = partySsn.get(b.id) ?? new Set<string>();
      const shareSsn = [...sa].some((x) => sb.has(x));
      const conflictSsn = sa.size > 0 && sb.size > 0 && !shareSsn; // ambos têm SSN e diferem
      let reason: "ssn" | "name" | null = null;
      if (shareSsn) reason = "ssn";
      else if (!conflictSsn && looseNameMatch(a.name, b.name)) reason = "name";
      if (!reason) continue;
      const [keep, drop] =
        score(a) > score(b) || (score(a) === score(b) && a.name.length >= b.name.length)
          ? [a, b]
          : [b, a];
      dups.push({ keep, drop, reason });
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Owners</h1>
          <p className="text-sm text-slate-500">{parties.length} registered</p>
        </div>
        <Link
          href="/parties/new"
          className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
        >
          + New owner
        </Link>
      </div>

      {dups.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="text-sm font-medium text-amber-800">
            Possible duplicate owners ({dups.length}) — same person registered more than once
          </div>
          {dups.map((d, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-white px-3 py-2"
            >
              <div className="text-sm">
                <span className="font-medium text-slate-800">{d.drop.name}</span>
                <span className="text-slate-400"> → </span>
                <span className="font-medium text-slate-800">{d.keep.name}</span>
                <span
                  className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                    d.reason === "ssn"
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-amber-100 text-amber-700"
                  }`}
                >
                  {d.reason === "ssn" ? "same SSN ✓" : "similar name — confirm"}
                </span>
              </div>
              <MergeOwnerButton
                keepId={d.keep.id}
                dropId={d.drop.id}
                keepName={d.keep.name}
                dropName={d.drop.name}
                confirmNeeded={d.reason === "name"}
              />
            </div>
          ))}
        </div>
      )}

      {parties.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 p-10 text-center text-slate-500">
          No owners registered yet.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">Tax jurisdiction</th>
                <th className="px-4 py-3 font-medium">Returns</th>
                <th className="px-4 py-3 font-medium">Holdings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {parties.map((p) => {
                const isPerson = p.kind === "PERSON";
                const NameCell = isPerson ? (
                  <Link
                    href={`/parties/${p.id}`}
                    className="font-medium text-[#1f3a5f] hover:underline"
                  >
                    {p.name}
                  </Link>
                ) : (
                  <span className="font-medium text-slate-800">{p.name}</span>
                );
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">{NameCell}</td>
                    <td className="px-4 py-3 text-slate-600">{labelForPartyKind(p.kind)}</td>
                    <td className="px-4 py-3 text-slate-600">
                      {labelForJurisdiction(p.taxJurisdiction)}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {p._count.personalReturns > 0 ? `${p._count.personalReturns} 1040s` : "—"}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {p._count.ownerStakes > 0 ? `${p._count.ownerStakes}` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
