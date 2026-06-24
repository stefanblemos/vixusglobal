"use client";

import { useMemo, useState } from "react";
import type { OrgNode, OrgEdge } from "@/lib/org/chart";

const BOXW = 156;
const BOXH = 46;

const ellipsize = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);

export function OrgChartSvg({
  nodes,
  edges,
  width,
  height,
}: {
  nodes: OrgNode[];
  edges: OrgEdge[];
  width: number;
  height: number;
}) {
  const [hover, setHover] = useState<string | null>(null);

  // Adjacência para calcular a linhagem (donos acima + investidas abaixo) do nó sob o mouse.
  const { parents, children } = useMemo(() => {
    const parents = new Map<string, string[]>();
    const children = new Map<string, string[]>();
    for (const e of edges) {
      (children.get(e.fromKey) ?? children.set(e.fromKey, []).get(e.fromKey)!).push(e.toKey);
      (parents.get(e.toKey) ?? parents.set(e.toKey, []).get(e.toKey)!).push(e.fromKey);
    }
    return { parents, children };
  }, [edges]);

  const lineage = useMemo(() => {
    if (!hover) return null;
    const set = new Set<string>([hover]);
    const walk = (k: string, m: Map<string, string[]>) => {
      for (const n of m.get(k) ?? []) {
        if (!set.has(n)) {
          set.add(n);
          walk(n, m);
        }
      }
    };
    walk(hover, parents);
    walk(hover, children);
    return set;
  }, [hover, parents, children]);

  const nodeOn = (key: string) => !lineage || lineage.has(key);
  const edgeOn = (e: OrgEdge) => !lineage || (lineage.has(e.fromKey) && lineage.has(e.toKey));

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="min-w-full">
      {/* arestas em cotovelo (ângulo reto), atrás das caixas */}
      {edges.map((e, i) => {
        const on = edgeOn(e);
        const midY = e.y1 + (e.y2 - e.y1) * 0.5;
        const d = `M ${e.x1} ${e.y1} V ${midY} H ${e.x2} V ${e.y2}`;
        const lx = (e.x1 + e.x2) / 2;
        return (
          <g key={i} opacity={on ? 1 : 0.12}>
            <path d={d} fill="none" stroke={on && lineage ? "#1f3a5f" : "#cbd5e1"} strokeWidth={on && lineage ? 1.8 : 1.3} />
            <rect x={lx - 17} y={midY - 8} width={34} height={15} rx={7} fill="#f1f5f9" />
            <text x={lx} y={midY + 2.5} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="#475569">
              {e.pct.toLocaleString("en-US", { maximumFractionDigits: 2 })}%
            </text>
          </g>
        );
      })}
      {/* caixas */}
      {nodes.map((n) => (
        <NodeBox
          key={n.key}
          n={n}
          dim={!nodeOn(n.key)}
          focus={hover === n.key}
          onEnter={() => setHover(n.key)}
          onLeave={() => setHover(null)}
        />
      ))}
    </svg>
  );
}

function NodeBox({
  n,
  dim,
  focus,
  onEnter,
  onLeave,
}: {
  n: OrgNode;
  dim: boolean;
  focus: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const person = n.kind === "person";
  const fill = person ? "#1f3a5f" : "#ffffff";
  const stroke = focus ? "#8DC63F" : n.isCorp ? "#f59e0b" : person ? "#1f3a5f" : "#cbd5e1";
  const strokeW = focus ? 2.5 : n.isCorp ? 2 : 1;
  const nameColor = person ? "#ffffff" : "#1e293b";
  const subColor = person ? "#c7d2e0" : "#64748b";

  return (
    <a
      href={n.kind === "company" ? `/companies/${n.id}` : `/parties/${n.id}`}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{ cursor: "pointer" }}
    >
      <g opacity={dim ? 0.18 : 1}>
        <rect x={n.x} y={n.y} width={BOXW} height={BOXH} rx={8} fill={fill} stroke={stroke} strokeWidth={strokeW} />
        <text x={n.x + 10} y={n.y + 18} fontSize={11} fontWeight={700} fill={nameColor}>
          {ellipsize(n.name, 24)}
        </text>
        <text x={n.x + 10} y={n.y + 33} fontSize={8.5} fill={subColor}>
          {n.acronym} · {n.tag}
          {n.ownedPct != null && n.ownedPct < 100 ? `  · donos: ${n.ownedPct}%` : ""}
        </text>
      </g>
    </a>
  );
}
