import { prisma } from "@/lib/db";
import { edgesFromOwnerships } from "@/lib/ownership/effective";
import { acronymOf } from "@/lib/closing/sequence";

// Organograma anual: árvore de donos × investidas (pass-through) com os percentuais.
// Donos finais (PF/holdings de topo) ficam em cima; cada nível abaixo é o que eles possuem,
// com o % na aresta. Layout em camadas (cada entidade aparece UMA vez), ordenado por
// baricentro dos pais para reduzir cruzamentos. Tudo vigente na data `asOf` do ano escolhido,
// então trocar dono no cadastro para aquele ano reflete aqui.

export interface OrgNode {
  key: string;
  kind: "company" | "person";
  id: string;
  name: string;
  acronym: string;
  tag: string; // "PF (1040)" | "C-corp" | "pass-through"
  isCorp: boolean;
  x: number; // canto da caixa
  y: number;
  ownedPct: number | null; // soma do que os donos cadastrados detêm desta entidade (cobertura)
}
export interface OrgEdge {
  fromKey: string; // dono (em cima)
  toKey: string; // possuída (embaixo)
  pct: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  lx: number;
  ly: number;
}
export interface OrgChart {
  year: number;
  years: number[];
  width: number;
  height: number;
  nodes: OrgNode[];
  edges: OrgEdge[];
}

const BOXW = 156;
const BOXH = 46;
const COLW = 184;
const ROWH = 96;
const MARGIN = 24;

export async function buildOrgChart(year: number): Promise<OrgChart> {
  const asOf = new Date(Date.UTC(year, 11, 31));
  const [companies, parties, ownerships, taxReturns] = await Promise.all([
    prisma.company.findMany({ select: { id: true, legalName: true } }),
    prisma.party.findMany({ where: { kind: "PERSON" }, select: { id: true, name: true } }),
    prisma.ownership.findMany({
      select: {
        ownerCompanyId: true,
        ownerPartyId: true,
        ownedCompanyId: true,
        ownedPartyId: true,
        percentage: true,
        effectiveDate: true,
        endDate: true,
      },
    }),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null } },
      select: { companyId: true, year: true, taxTreatment: true, taxForm: true },
    }),
  ]);

  // Anos disponíveis no seletor: trocas de ownership + anos com IR + ano corrente e anterior.
  const yearSet = new Set<number>();
  const now = new Date(asOf); // asOf é determinístico; usamos só o ano-base para current
  for (const o of ownerships) {
    if (o.effectiveDate) yearSet.add(o.effectiveDate.getUTCFullYear());
    if (o.endDate) yearSet.add(o.endDate.getUTCFullYear());
  }
  for (const t of taxReturns) if (t.year) yearSet.add(t.year);
  yearSet.add(year);
  yearSet.add(now.getUTCFullYear());
  yearSet.add(now.getUTCFullYear() - 1);
  const years = [...yearSet].filter((y) => y >= 2000 && y <= 2100).sort((a, b) => b - a);

  // Tributação por empresa (último IR) → marca C-corp vs pass-through.
  const treat = new Map<string, string>();
  for (const t of taxReturns.sort((a, b) => (a.year ?? 0) - (b.year ?? 0))) {
    if (t.companyId) treat.set(t.companyId, t.taxTreatment ?? t.taxForm ?? "");
  }
  const isCorp = (id: string) => /c.?corp|1120(?!-s)/i.test(treat.get(id) ?? "");

  const ck = (id: string) => `c:${id}`;
  const pk = (id: string) => `p:${id}`;
  const meta = new Map<string, { kind: "company" | "person"; id: string; name: string }>();
  for (const c of companies) meta.set(ck(c.id), { kind: "company", id: c.id, name: c.legalName });
  for (const p of parties) meta.set(pk(p.id), { kind: "person", id: p.id, name: p.name });

  // Arestas vigentes (dono → possuída). Só consideramos possuídas que são EMPRESAS (pass-through).
  const edges: { from: string; to: string; pct: number }[] = [];
  for (const e of edgesFromOwnerships(ownerships, asOf)) {
    if (e.ownedType !== "company") continue;
    const from = e.ownerType === "party" ? pk(e.ownerId) : ck(e.ownerId);
    const to = ck(e.ownedId);
    if (!meta.has(from) || !meta.has(to) || from === to) continue;
    edges.push({ from, to, pct: e.percentage });
  }

  // Nós que participam do grafo (donos ou possuídos).
  const inGraph = new Set<string>();
  for (const e of edges) {
    inGraph.add(e.from);
    inGraph.add(e.to);
  }
  if (inGraph.size === 0) {
    return { year, years, width: MARGIN * 2, height: MARGIN * 2, nodes: [], edges: [] };
  }

  const childrenOf = new Map<string, { key: string; pct: number }[]>();
  const parentsOf = new Map<string, { key: string; pct: number }[]>();
  for (const e of edges) {
    (childrenOf.get(e.from) ?? childrenOf.set(e.from, []).get(e.from)!).push({ key: e.to, pct: e.pct });
    (parentsOf.get(e.to) ?? parentsOf.set(e.to, []).get(e.to)!).push({ key: e.from, pct: e.pct });
  }

  // Camada = 0 se não tem dono cadastrado (UBO/topo); senão 1 + max(camada dos donos).
  // Relaxação iterativa; nós em ciclo recebem fallback ao final.
  const layer = new Map<string, number>();
  const keys = [...inGraph];
  let changed = true;
  let guard = keys.length + 2;
  while (changed && guard-- > 0) {
    changed = false;
    for (const k of keys) {
      if (layer.has(k)) continue;
      const ps = parentsOf.get(k) ?? [];
      if (ps.length === 0) {
        layer.set(k, 0);
        changed = true;
      } else if (ps.every((p) => layer.has(p.key))) {
        layer.set(k, 1 + Math.max(...ps.map((p) => layer.get(p.key)!)));
        changed = true;
      }
    }
  }
  let fallback = Math.max(0, ...layer.values()) + 1;
  for (const k of keys) if (!layer.has(k)) layer.set(k, fallback++); // ciclos

  // Agrupa por camada e ordena para minimizar cruzamentos (heurística de baricentro tipo
  // Sugiyama): inicializa pelos pais e depois alterna varreduras desce/sobe algumas vezes —
  // cada nó busca a média das posições dos vizinhos, reduzindo o emaranhado de linhas.
  const maxLayer = Math.max(...layer.values());
  const byLayer: string[][] = Array.from({ length: maxLayer + 1 }, () => []);
  for (const k of keys) byLayer[layer.get(k)!].push(k);
  const order = new Map<string, number>(); // posição (coluna) do nó dentro da sua camada
  const reindex = (L: number) => byLayer[L].forEach((k, i) => order.set(k, i));
  const meanOf = (list: { key: string }[]) => {
    const xs = list.filter((n) => order.has(n.key)).map((n) => order.get(n.key)!);
    return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
  };
  const sweep = (L: number, neighbors: Map<string, { key: string }[]>) => {
    const cur = new Map(byLayer[L].map((k, i) => [k, i]));
    byLayer[L].sort((a, b) => {
      const ba = meanOf(neighbors.get(a) ?? []) ?? cur.get(a)!;
      const bb = meanOf(neighbors.get(b) ?? []) ?? cur.get(b)!;
      return ba - bb || cur.get(a)! - cur.get(b)!;
    });
    reindex(L);
  };

  byLayer[0].sort((a, b) => meta.get(a)!.name.localeCompare(meta.get(b)!.name));
  reindex(0);
  for (let L = 1; L <= maxLayer; L++) sweep(L, parentsOf); // posição inicial pelos pais
  for (let iter = 0; iter < 4; iter++) {
    for (let L = 1; L <= maxLayer; L++) sweep(L, parentsOf); // desce: alinha pelos donos
    for (let L = maxLayer - 1; L >= 0; L--) sweep(L, childrenOf); // sobe: alinha pelas investidas
  }

  const maxCols = Math.max(...byLayer.map((l) => l.length));
  const width = MARGIN * 2 + Math.max(1, maxCols) * COLW;
  const height = MARGIN * 2 + (maxLayer + 1) * ROWH;

  // Posições — centraliza cada camada na largura total.
  const pos = new Map<string, { x: number; y: number }>();
  byLayer.forEach((lay, L) => {
    const offset = ((maxCols - lay.length) * COLW) / 2;
    lay.forEach((k, i) => {
      pos.set(k, { x: MARGIN + offset + i * COLW + (COLW - BOXW) / 2, y: MARGIN + L * ROWH });
    });
  });

  const coverage = new Map<string, number>();
  for (const [k, ps] of parentsOf) coverage.set(k, ps.reduce((s, p) => s + p.pct, 0));

  const nodes: OrgNode[] = keys.map((k) => {
    const m = meta.get(k)!;
    const p = pos.get(k)!;
    const corp = m.kind === "company" && isCorp(m.id);
    return {
      key: k,
      kind: m.kind,
      id: m.id,
      name: m.name,
      acronym: acronymOf(m.name, m.kind === "person" ? "person" : "company"),
      tag: m.kind === "person" ? "PF (1040)" : corp ? "C-corp" : "pass-through",
      isCorp: corp,
      x: p.x,
      y: p.y,
      ownedPct: coverage.has(k) ? Math.round(coverage.get(k)!) : null,
    };
  });

  const outEdges: OrgEdge[] = edges.map((e) => {
    const a = pos.get(e.from)!;
    const b = pos.get(e.to)!;
    const x1 = a.x + BOXW / 2;
    const y1 = a.y + BOXH;
    const x2 = b.x + BOXW / 2;
    const y2 = b.y;
    return { fromKey: e.from, toKey: e.to, pct: e.pct, x1, y1, x2, y2, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 };
  });

  return { year, years, width, height, nodes, edges: outEdges };
}

export const ORG_BOX = { BOXW, BOXH };
