"use client";

import { useState } from "react";

/**
 * Cronograma — visual (refação 16/07 pedida pelo Stefan): cada fase é UMA BARRA
 * início→fim (não marcos), em largura total legível; consolidado do pool no topo
 * (igual ao gráfico de fases da simulação); linha vertical = hoje.
 */

export type Span = { start: string; end: string | null }; // end null = em curso (até hoje)
export type Phase = { label: string; prev: Span | null; real: Span | null };
export type Cell = { key: string; label: string; prev: string | null; real: string | null; delta: number | null };
export type RowData = { houseId: string; addr: string; sub: string; cells: Cell[]; phases: Phase[] };

const fmt = (iso: string | null) =>
  iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(2, 4)}` : "—";

function DeltaBadge({ d, tolerance }: { d: number | null; tolerance: number }) {
  if (d == null) return null;
  if (Math.abs(d) <= tolerance)
    return (
      <div className="text-[10.5px] font-bold text-emerald-700">
        {d === 0 ? "no dia" : `${d > 0 ? "+" : "−"}${Math.abs(d)}d`} ✓
      </div>
    );
  return d < 0 ? (
    <div className="text-[10.5px] font-bold text-emerald-700">−{Math.abs(d)}d ✓</div>
  ) : (
    <div className="text-[10.5px] font-bold text-red-700">+{d}d ⚠</div>
  );
}

// barras de fase sobre um range global — prev (cinza, em cima) e real (navy, embaixo);
// real em curso (sem fim) vai até HOJE com visual "aberto"
export function PhaseGantt({
  phases,
  range,
  height = "lg",
}: {
  phases: Phase[];
  range: { min: string; max: string; today: string };
  height?: "lg" | "md";
}) {
  const minT = new Date(range.min).getTime();
  const maxT = Math.max(new Date(range.max).getTime(), new Date(range.today).getTime());
  const span = Math.max(1, maxT - minT);
  const pos = (iso: string) => Math.max(0, Math.min(100, ((new Date(iso).getTime() - minT) / span) * 100));
  const todayPos = pos(range.today);
  const rowH = height === "lg" ? "h-7" : "h-6";
  const barH = height === "lg" ? "h-2.5" : "h-2";

  const bar = (s: Span, cls: string, open: boolean, title: string) => {
    const left = pos(s.start);
    const right = pos(s.end ?? range.today);
    const width = Math.max(0.9, right - left);
    return (
      <div
        title={title}
        className={`absolute rounded-sm ${barH} ${cls} ${open ? "opacity-70" : ""}`}
        style={{
          left: `${left}%`,
          width: `${width}%`,
          ...(open
            ? { backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,.5) 4px, rgba(255,255,255,.5) 7px)" }
            : {}),
        }}
      />
    );
  };

  return (
    <div>
      {phases.map((p) => (
        <div key={p.label} className={`grid grid-cols-[110px_1fr] items-center gap-2 ${rowH}`}>
          <span className="text-[11px] text-slate-500">{p.label}</span>
          <div className="relative h-full rounded bg-slate-50">
            {/* hoje */}
            <div className="absolute bottom-0 top-0 w-px border-l border-dashed border-red-400" style={{ left: `${todayPos}%` }} />
            {p.prev &&
              bar(
                { ...p.prev },
                "top-0.5 bg-slate-300",
                false,
                `previsto: ${fmt(p.prev.start)} → ${fmt(p.prev.end)}`,
              )}
            {p.real &&
              bar(
                p.real,
                "bottom-0.5 bg-[#1f3a5f]",
                p.real.end == null,
                `realizado: ${fmt(p.real.start)} → ${p.real.end ? fmt(p.real.end) : "em curso"}`,
              )}
          </div>
        </div>
      ))}
      <div className="mt-1.5 flex items-center gap-4 text-[10px] text-slate-400">
        <span><i className="mr-1 inline-block h-1.5 w-4 rounded-sm bg-slate-300 align-middle" />previsto (congelado)</span>
        <span><i className="mr-1 inline-block h-1.5 w-4 rounded-sm bg-[#1f3a5f] align-middle" />realizado</span>
        <span><i className="mr-1 inline-block h-1.5 w-4 rounded-sm bg-[#1f3a5f] align-middle opacity-70" style={{ backgroundImage: "repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(255,255,255,.5) 4px, rgba(255,255,255,.5) 7px)" }} />em curso</span>
        <span className="text-red-400">┊ hoje</span>
        <span className="ml-auto tabular-nums">{fmt(range.min)} — {fmt(range.max)}</span>
      </div>
    </div>
  );
}

export function ScheduleTable({
  rows,
  milestones,
  range,
  tolerance,
}: {
  rows: RowData[];
  milestones: Array<{ key: string; label: string }>;
  range: { min: string; max: string; today: string };
  tolerance: number;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-slate-100">
            <th className="px-3 py-2 text-left text-[10px] font-medium uppercase tracking-wide text-slate-400" style={{ width: "19%" }}>
              Casa
            </th>
            {milestones.map((m) => (
              <th key={m.key} className="px-2 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-slate-400">
                {m.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <RowPair key={r.houseId} r={r} colCount={milestones.length + 1} isOpen={open.has(r.houseId)} onToggle={() => toggle(r.houseId)} range={range} tolerance={tolerance} />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RowPair({
  r,
  colCount,
  isOpen,
  onToggle,
  range,
  tolerance,
}: {
  r: RowData;
  colCount: number;
  isOpen: boolean;
  onToggle: () => void;
  range: { min: string; max: string; today: string };
  tolerance: number;
}) {
  const today = range.today;
  return (
    <>
      <tr className="border-b border-slate-50 align-top">
        <td className="cursor-pointer px-3 py-2" onClick={onToggle}>
          <div className="text-xs font-bold text-[#1f3a5f] hover:underline">
            {isOpen ? "▾" : "▸"} {r.addr}
          </div>
          <div className="text-[10px] text-slate-400">{r.sub}</div>
        </td>
        {r.cells.map((c) => (
          <td key={c.key} className="px-2 py-2 text-center">
            {c.real ? (
              <>
                <div className="text-xs font-bold tabular-nums text-slate-800">{fmt(c.real)}</div>
                {c.prev && <div className="text-[10px] tabular-nums text-slate-400">prev {fmt(c.prev)}</div>}
                <DeltaBadge d={c.delta} tolerance={tolerance} />
              </>
            ) : c.prev ? (
              <>
                <div className="text-xs tabular-nums text-slate-400">prev {fmt(c.prev)}</div>
                {c.prev < today ? (
                  <div className="text-[10px] font-semibold text-amber-700">registrar</div>
                ) : (
                  <div className="text-[10px] text-slate-300">futuro</div>
                )}
              </>
            ) : (
              <div className="text-xs text-slate-300">—</div>
            )}
          </td>
        ))}
      </tr>
      {isOpen && (
        <tr className="border-b border-slate-100 bg-slate-50/50">
          <td colSpan={colCount} className="px-4 py-3">
            <PhaseGantt phases={r.phases} range={range} height="md" />
          </td>
        </tr>
      )}
    </>
  );
}
