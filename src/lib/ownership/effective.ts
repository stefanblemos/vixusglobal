// Cálculo de participação efetiva e beneficiário final (UBO).
//
// O grafo de ownership é recursivo: tanto Party quanto Company podem ser
// donos e/ou possuídos. A participação efetiva de um dono sobre um alvo é a
// SOMA, por todos os caminhos, do PRODUTO dos percentuais ao longo da cadeia.
// Trata ciclos (participações cruzadas) parando o caminho ao reencontrar um nó.

export type NodeType = "party" | "company";

export interface OwnershipEdge {
  ownerType: NodeType;
  ownerId: string;
  ownedType: NodeType;
  ownedId: string;
  percentage: number; // 0..100
}

export interface OwnerShare {
  key: string; // "party:<id>" | "company:<id>"
  type: NodeType;
  id: string;
  percentage: number; // participação efetiva no alvo (0..100)
  ultimate: boolean; // true se é um beneficiário final (sem donos acima)
}

export const nodeKey = (type: NodeType, id: string) => `${type}:${id}`;

/**
 * Retorna os donos efetivos de um alvo.
 * - ultimateOnly=true → só os beneficiários finais (UBO), sem donos acima.
 * - ultimateOnly=false → todos os ancestrais (inclui holdings intermediárias),
 *   cada um com sua participação efetiva no alvo.
 *
 * Também reporta `coverage`: soma das participações dos UBOs. Se < 100, há
 * ownership não cadastrado (lacuna) — sinal para o usuário completar os dados.
 */
export function computeEffectiveOwners(
  targetType: NodeType,
  targetId: string,
  edges: OwnershipEdge[],
  opts: { ultimateOnly?: boolean } = {},
): { owners: OwnerShare[]; coverage: number; hasCycle: boolean } {
  const ownersByOwned = new Map<string, OwnershipEdge[]>();
  for (const e of edges) {
    const k = nodeKey(e.ownedType, e.ownedId);
    const list = ownersByOwned.get(k);
    if (list) list.push(e);
    else ownersByOwned.set(k, [e]);
  }

  const result = new Map<string, OwnerShare>();
  let hasCycle = false;

  const add = (e: OwnershipEdge, contributed: number, ultimate: boolean) => {
    const key = nodeKey(e.ownerType, e.ownerId);
    const prev = result.get(key);
    if (prev) prev.percentage += contributed;
    else
      result.set(key, {
        key,
        type: e.ownerType,
        id: e.ownerId,
        percentage: contributed,
        ultimate,
      });
  };

  const visit = (type: NodeType, id: string, share: number, path: Set<string>) => {
    const parents = ownersByOwned.get(nodeKey(type, id)) ?? [];
    for (const e of parents) {
      const ownerKey = nodeKey(e.ownerType, e.ownerId);
      if (path.has(ownerKey)) {
        hasCycle = true;
        continue; // corta o ciclo
      }
      const contributed = share * (e.percentage / 100);
      const ownerIsUltimate = (ownersByOwned.get(ownerKey) ?? []).length === 0;
      if (!opts.ultimateOnly || ownerIsUltimate) {
        add(e, contributed, ownerIsUltimate);
      }
      const nextPath = new Set(path);
      nextPath.add(ownerKey);
      visit(e.ownerType, e.ownerId, contributed, nextPath);
    }
  };

  visit(targetType, targetId, 100, new Set([nodeKey(targetType, targetId)]));

  const owners = Array.from(result.values()).sort((a, b) => b.percentage - a.percentage);
  const coverage = owners.filter((o) => o.ultimate).reduce((s, o) => s + o.percentage, 0);
  return { owners, coverage, hasCycle };
}

/** Linha de Ownership vinda do Prisma (campos relevantes). */
export interface OwnershipRow {
  ownerPartyId: string | null;
  ownerCompanyId: string | null;
  ownedPartyId: string | null;
  ownedCompanyId: string | null;
  percentage: { toString(): string } | number | string;
  effectiveDate?: Date | null;
  endDate?: Date | null;
}

/** Converte linhas de Ownership do banco em arestas vigentes na data `asOf`
 * (já entrou: effectiveDate ≤ asOf; ainda não saiu: endDate > asOf). */
export function edgesFromOwnerships(
  rows: OwnershipRow[],
  asOf: Date = new Date(),
): OwnershipEdge[] {
  const edges: OwnershipEdge[] = [];
  for (const r of rows) {
    if (r.endDate && r.endDate <= asOf) continue;
    if (r.effectiveDate && r.effectiveDate > asOf) continue; // ainda não vigente
    const ownerType: NodeType | null = r.ownerPartyId
      ? "party"
      : r.ownerCompanyId
        ? "company"
        : null;
    const ownerId = r.ownerPartyId ?? r.ownerCompanyId;
    const ownedType: NodeType | null = r.ownedPartyId
      ? "party"
      : r.ownedCompanyId
        ? "company"
        : null;
    const ownedId = r.ownedPartyId ?? r.ownedCompanyId;
    if (!ownerType || !ownerId || !ownedType || !ownedId) continue;
    edges.push({ ownerType, ownerId, ownedType, ownedId, percentage: Number(r.percentage) });
  }
  return edges;
}
