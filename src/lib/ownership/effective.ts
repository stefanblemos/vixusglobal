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

// Fim do ano-calendário (31/dez) — a data padrão para "donos vigentes no ano Y". Use isto em
// QUALQUER cálculo por ano (preview, reserve, quarterly, sequence) para todos usarem a MESMA
// estrutura societária vigente, em vez de "donos de hoje" (endDate null) ou datas ad-hoc.
export const asOfYearEnd = (year: number) => new Date(Date.UTC(year, 11, 31, 23, 59, 59));

/**
 * Uma linha de ownership está vigente NO INSTANTE `asOf`? Snapshot PONTUAL (não sobreposição de
 * intervalo). FONTE ÚNICA da regra de vigência — usada aqui e nos consumidores por ano (preview,
 * reserve, quarterly, sequence), sempre com asOfYearEnd(Y).
 *
 * Convenção HALF-OPEN [effectiveDate, endDate): já entrou (effectiveDate ≤ asOf) e ainda não saiu
 * (endDate > asOf). Ou seja, `endDate` é o PRIMEIRO instante SEM posse (não o último dia com posse).
 *
 * Fronteira de ano: asOfYearEnd(Y) = 31/dez Y 23:59:59. O cadastro grava endDate à meia-noite do dia
 * informado (00:00:00Z). Logo uma saída lançada como "31/12/Y" (= 31/dez 00:00:00) tem endDate ≤ asOf
 * → NÃO vigente no fim de Y (o vínculo conta como encerrado ANTES do fechamento). Para o sócio ser
 * incluído no K-1 de Y (posse pelo ano inteiro), lançar a saída como 01/jan/(Y+1) — o primeiro dia
 * sem posse. Snapshot as-of-fim-de-ano é aproximação: saídas no meio do ano zeram o K-1 do ano.
 */
export function isEffectiveAt(
  r: { effectiveDate?: Date | null; endDate?: Date | null },
  asOf: Date,
): boolean {
  if (r.endDate && r.endDate <= asOf) return false;
  if (r.effectiveDate && r.effectiveDate > asOf) return false;
  return true;
}

/** Converte linhas de Ownership do banco em arestas vigentes na data `asOf`. */
export function edgesFromOwnerships(
  rows: OwnershipRow[],
  asOf: Date = new Date(),
): OwnershipEdge[] {
  const edges: OwnershipEdge[] = [];
  for (const r of rows) {
    if (!isEffectiveAt(r, asOf)) continue;
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
