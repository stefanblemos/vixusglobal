import { prisma } from "@/lib/db";
import { mailConfigured, sendMail } from "./send";
import { appBaseUrl } from "./base-url";
import { distributionEmail, reportPublishedEmail } from "./templates";
import { payoutStatus } from "@/lib/pools/payout";

/**
 * #69 — notificações por e-mail (dormente sem RESEND_API_KEY, igual ao convite do portal).
 * TODAS best-effort: nunca derrubam a ação principal. E-mail nunca traz instrução de wire.
 */

const norm = (s: string) => s.trim().toLowerCase();

// e-mails de LOGIN (InvestorAccess) por entidade — só quem já tem acesso ao portal recebe.
async function emailsByEntity(partyIds: string[], companyIds: string[]) {
  const byParty = new Map<string, Set<string>>();
  const byCompany = new Map<string, Set<string>>();
  if (!partyIds.length && !companyIds.length) return { byParty, byCompany };
  const access = await prisma.investorAccess.findMany({
    where: {
      OR: [
        ...(partyIds.length ? [{ partyId: { in: partyIds } }] : []),
        ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
      ],
    },
    select: { partyId: true, companyId: true, user: { select: { email: true } } },
  });
  for (const a of access) {
    const email = a.user?.email ? norm(a.user.email) : null;
    if (!email) continue;
    if (a.partyId) (byParty.get(a.partyId) ?? byParty.set(a.partyId, new Set()).get(a.partyId)!).add(email);
    if (a.companyId) (byCompany.get(a.companyId) ?? byCompany.set(a.companyId, new Set()).get(a.companyId)!).add(email);
  }
  return { byParty, byCompany };
}

// Avisa cada sócio (com acesso) que há distribuição na posição dele. Copy adapta se a conta
// ainda não está confirmada (vira o lembrete de conta pendente — evento 2 do #69).
export async function notifyDistribution(distributionId: string): Promise<void> {
  if (!mailConfigured()) return;
  try {
    const dist = await prisma.poolDistribution.findUnique({
      where: { id: distributionId },
      include: {
        pool: { select: { name: true } },
        lines: { include: { member: { include: { party: true, company: true } } } },
      },
    });
    if (!dist) return;

    const partyIds = dist.lines.map((l) => l.member.partyId).filter((x): x is string => !!x);
    const companyIds = dist.lines.map((l) => l.member.companyId).filter((x): x is string => !!x);
    const { byParty, byCompany } = await emailsByEntity(partyIds, companyIds);

    const accounts = await prisma.payoutAccount.findMany({
      where: {
        OR: [
          ...(partyIds.length ? [{ partyId: { in: partyIds } }] : []),
          ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
        ],
      },
      select: { partyId: true, companyId: true, status: true, keyHash: true },
    });
    const accByParty = new Map(accounts.filter((a) => a.partyId).map((a) => [a.partyId!, a]));
    const accByCompany = new Map(accounts.filter((a) => a.companyId).map((a) => [a.companyId!, a]));

    const portalUrl = `${await appBaseUrl()}/portal`;

    for (const l of dist.lines) {
      const m = l.member;
      const emails = m.companyId ? byCompany.get(m.companyId) : m.partyId ? byParty.get(m.partyId) : undefined;
      if (!emails || emails.size === 0) continue; // sem login no portal → nada a enviar
      const acc = m.companyId ? accByCompany.get(m.companyId) : m.partyId ? accByParty.get(m.partyId) : undefined;
      const needsAccount = payoutStatus(acc ?? null) !== "CONFIRMED";
      const entityName = m.company?.tradeName || m.company?.legalName || m.party?.name || "investidor";
      const mail = distributionEmail({
        entityName,
        poolName: dist.pool.name,
        kind: dist.kind as "RETURN_OF_CAPITAL" | "PROFIT",
        portalUrl,
        needsAccount,
      });
      for (const to of emails) await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text });
    }
  } catch {
    // best-effort
  }
}

// Avisa os sócios (com acesso) de que um novo report mensal foi publicado.
export async function notifyReportPublished(poolId: string, period: string): Promise<void> {
  if (!mailConfigured()) return;
  try {
    const pool = await prisma.investmentPool.findUnique({
      where: { id: poolId },
      select: { name: true, members: { select: { partyId: true, companyId: true, party: true, company: true } } },
    });
    if (!pool) return;
    const partyIds = pool.members.map((m) => m.partyId).filter((x): x is string => !!x);
    const companyIds = pool.members.map((m) => m.companyId).filter((x): x is string => !!x);
    const { byParty, byCompany } = await emailsByEntity(partyIds, companyIds);
    const portalUrl = `${await appBaseUrl()}/portal`;
    const sent = new Set<string>();
    for (const m of pool.members) {
      const emails = m.companyId ? byCompany.get(m.companyId) : m.partyId ? byParty.get(m.partyId) : undefined;
      if (!emails) continue;
      const entityName = m.company?.tradeName || m.company?.legalName || m.party?.name || "investidor";
      const mail = reportPublishedEmail({ entityName, poolName: pool.name, period, portalUrl });
      for (const to of emails) {
        if (sent.has(to)) continue; // um e-mail em várias entidades recebe uma vez
        sent.add(to);
        await sendMail({ to, subject: mail.subject, html: mail.html, text: mail.text });
      }
    }
  } catch {
    // best-effort
  }
}
