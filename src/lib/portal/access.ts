import crypto from "crypto";
import { prisma } from "@/lib/db";

/**
 * Portal do investidor (#68) — núcleo de acesso: magic-link (token de uso único, ~15 min,
 * só o hash é guardado) e resolução do ESCOPO por entidade (multi). O investidor só enxerga
 * os pools onde alguma entidade vinculada ao login é PoolMember. Tudo read-only.
 */

const TTL_MIN = 15;
const hash = (raw: string) => crypto.createHash("sha256").update(raw).digest("hex");
const norm = (e: string) => e.trim().toLowerCase();

// gera o token e devolve o RAW (que vai no link); no banco fica só o hash
export async function createPortalToken(email: string): Promise<string> {
  const raw = crypto.randomBytes(32).toString("hex");
  await prisma.portalLoginToken.create({
    data: { tokenHash: hash(raw), email: norm(email), expiresAt: new Date(Date.now() + TTL_MIN * 60_000) },
  });
  return raw;
}

// valida e CONSOME o token (uso único); devolve o User INVESTOR do e-mail, se existir
export async function consumePortalToken(raw: string): Promise<{ userId: string; email: string } | null> {
  if (!raw) return null;
  const rec = await prisma.portalLoginToken.findUnique({ where: { tokenHash: hash(raw) } });
  if (!rec || rec.usedAt || rec.expiresAt < new Date()) return null;
  const user = await prisma.user.findFirst({ where: { email: rec.email, role: "INVESTOR" } });
  if (!user) return null;
  const now = new Date();
  await prisma.$transaction([
    prisma.portalLoginToken.update({ where: { id: rec.id }, data: { usedAt: now } }),
    // 1º acesso efetivo → o investidor passa a contar como ATIVO na aba Investidores
    prisma.user.update({ where: { id: user.id }, data: { lastPortalLoginAt: now } }),
  ]);
  return { userId: user.id, email: rec.email };
}

// Estado do portal por SÓCIO (aba Investidores): sem acesso → convidado → ativo.
// "ativo" = já entrou pelo menos uma vez (lastPortalLoginAt do User do e-mail vinculado).
export type PortalMemberStatus = {
  status: "NONE" | "INVITED" | "ACTIVE";
  email: string | null;
  invitedAt: Date | null;
  lastLoginAt: Date | null;
};

export async function portalStatusByMember(
  members: Array<{ id: string; partyId: string | null; companyId: string | null }>,
): Promise<Record<string, PortalMemberStatus>> {
  const partyIds = members.map((m) => m.partyId).filter((x): x is string => !!x);
  const companyIds = members.map((m) => m.companyId).filter((x): x is string => !!x);
  const out: Record<string, PortalMemberStatus> = {};
  for (const m of members) out[m.id] = { status: "NONE", email: null, invitedAt: null, lastLoginAt: null };
  if (partyIds.length === 0 && companyIds.length === 0) return out;

  const access = await prisma.investorAccess.findMany({
    where: {
      OR: [
        ...(partyIds.length ? [{ partyId: { in: partyIds } }] : []),
        ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
      ],
    },
    select: {
      partyId: true,
      companyId: true,
      invitedAt: true,
      user: { select: { email: true, lastPortalLoginAt: true } },
    },
  });
  for (const m of members) {
    const a = access.find((x) => (m.partyId && x.partyId === m.partyId) || (m.companyId && x.companyId === m.companyId));
    if (!a) continue;
    out[m.id] = {
      status: a.user.lastPortalLoginAt ? "ACTIVE" : "INVITED",
      email: a.user.email,
      invitedAt: a.invitedAt,
      lastLoginAt: a.user.lastPortalLoginAt,
    };
  }
  return out;
}

// entidades (Party/Company) que este login pode ver
export async function investorEntities(userId: string) {
  const access = await prisma.investorAccess.findMany({
    where: { userId },
    select: {
      party: { select: { id: true, name: true } },
      company: { select: { id: true, legalName: true, tradeName: true } },
    },
  });
  const entities = access
    .map((a) =>
      // key no MESMO formato do app interno (c_<id> / p_<id>) — é a chave do loadInvestorPortfolio
      a.party
        ? { key: `p_${a.party.id}`, kind: "PARTY" as const, id: a.party.id, name: a.party.name }
        : a.company
          ? { key: `c_${a.company.id}`, kind: "COMPANY" as const, id: a.company.id, name: a.company.tradeName || a.company.legalName }
          : null,
    )
    .filter((e): e is NonNullable<typeof e> => e != null)
    .sort((a, b) => a.name.localeCompare(b.name));
  return entities;
}

// pools onde a(s) entidade(s) do escopo são PoolMember. Se entityKey vier, restringe a ela.
export async function investorPoolMemberships(userId: string, entityKey?: string) {
  const entities = await investorEntities(userId);
  const scoped = entityKey ? entities.filter((e) => e.key === entityKey) : entities;
  const partyIds = scoped.filter((e) => e.kind === "PARTY").map((e) => e.id);
  const companyIds = scoped.filter((e) => e.kind === "COMPANY").map((e) => e.id);
  if (partyIds.length === 0 && companyIds.length === 0) return { entities, members: [] as InvestorMember[] };

  const members = await prisma.poolMember.findMany({
    where: {
      OR: [
        ...(partyIds.length ? [{ partyId: { in: partyIds } }] : []),
        ...(companyIds.length ? [{ companyId: { in: companyIds } }] : []),
      ],
    },
    select: {
      id: true,
      role: true,
      poolId: true,
      party: { select: { name: true } },
      company: { select: { legalName: true, tradeName: true } },
      pool: { select: { id: true, code: true, alias: true, status: true, currency: true } },
    },
  });
  const mapped: InvestorMember[] = members.map((m) => ({
    memberId: m.id,
    poolId: m.poolId,
    poolCode: m.pool.code,
    poolAlias: m.pool.alias,
    poolStatus: m.pool.status,
    currency: m.pool.currency,
    entityName: m.party?.name || m.company?.tradeName || m.company?.legalName || "—",
  }));
  return { entities, members: mapped };
}

export type InvestorMember = {
  memberId: string;
  poolId: string;
  poolCode: string;
  poolAlias: string | null;
  poolStatus: string;
  currency: string;
  entityName: string;
};

// o login pode ver este pool? (guarda de rota do portal)
export async function investorCanSeePool(userId: string, poolId: string): Promise<boolean> {
  const { members } = await investorPoolMemberships(userId);
  return members.some((m) => m.poolId === poolId);
}
