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
  await prisma.portalLoginToken.update({ where: { id: rec.id }, data: { usedAt: new Date() } });
  return { userId: user.id, email: rec.email };
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
      a.party
        ? { key: `p:${a.party.id}`, kind: "PARTY" as const, id: a.party.id, name: a.party.name }
        : a.company
          ? { key: `c:${a.company.id}`, kind: "COMPANY" as const, id: a.company.id, name: a.company.tradeName || a.company.legalName }
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
