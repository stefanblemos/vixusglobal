import { prisma } from "@/lib/db";
import { maskAccount, payoutStatus, type PayoutStatus } from "./payout";

/**
 * #69 — carga (Prisma) da conta de recebimento por sócio/entidade. Separado do núcleo puro
 * (payout.ts). A conta é da ENTIDADE (Party/Company), reutilizada entre pools.
 */

export type MemberPayout = {
  memberId: string;
  entityKey: string | null; // c_<id> | p_<id>
  status: PayoutStatus;
  accountId: string | null;
  beneficiaryName: string;
  bankName: string;
  routingNumber: string | null;
  accountNumber: string; // completo — visível só ao operador (que faz o wire) e ao dono no portal
  accountType: string | null;
  swift: string | null;
  iban: string | null;
  bankAddress: string | null;
  mask: string; // ••1234 | —
  confirmedAt: Date | null;
  confirmedByEmail: string | null;
  enteredByEmail: string | null;
};

function entityKeyOf(m: { partyId: string | null; companyId: string | null }): string | null {
  return m.companyId ? `c_${m.companyId}` : m.partyId ? `p_${m.partyId}` : null;
}

// Mapa memberId → conta de recebimento da entidade do sócio (ou "sem conta").
export async function payoutByMember(
  members: Array<{ id: string; partyId: string | null; companyId: string | null }>,
): Promise<Record<string, MemberPayout>> {
  const partyIds = members.map((m) => m.partyId).filter((x): x is string => !!x);
  const companyIds = members.map((m) => m.companyId).filter((x): x is string => !!x);

  const accounts =
    partyIds.length || companyIds.length
      ? await prisma.payoutAccount.findMany({
          where: {
            OR: [
              ...(partyIds.length ? [{ partyId: { in: partyIds } }] : []),
              ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
            ],
          },
        })
      : [];
  const byParty = new Map(accounts.filter((a) => a.partyId).map((a) => [a.partyId!, a]));
  const byCompany = new Map(accounts.filter((a) => a.companyId).map((a) => [a.companyId!, a]));

  const out: Record<string, MemberPayout> = {};
  for (const m of members) {
    const acc = m.companyId ? byCompany.get(m.companyId) : m.partyId ? byParty.get(m.partyId) : undefined;
    out[m.id] = {
      memberId: m.id,
      entityKey: entityKeyOf(m),
      status: payoutStatus(acc ?? null),
      accountId: acc?.id ?? null,
      beneficiaryName: acc?.beneficiaryName ?? "",
      bankName: acc?.bankName ?? "",
      routingNumber: acc?.routingNumber ?? null,
      accountNumber: acc?.accountNumber ?? "",
      accountType: acc?.accountType ?? null,
      swift: acc?.swift ?? null,
      iban: acc?.iban ?? null,
      bankAddress: acc?.bankAddress ?? null,
      mask: maskAccount(acc?.accountNumber),
      confirmedAt: acc?.confirmedAt ?? null,
      confirmedByEmail: acc?.confirmedByEmail ?? null,
      enteredByEmail: acc?.enteredByEmail ?? null,
    };
  }
  return out;
}

// Conta de uma entidade pela chave (portal + checagem de e-mail). Devolve o registro cru.
export async function payoutForEntityKey(entityKey: string) {
  const kind = entityKey.slice(0, 1);
  const id = entityKey.slice(2);
  if ((kind !== "c" && kind !== "p") || !id) return null;
  return prisma.payoutAccount.findFirst({ where: kind === "c" ? { companyId: id } : { partyId: id } });
}
