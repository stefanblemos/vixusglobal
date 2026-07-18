// Gráfico único de valor por unit (Fase 4, mock v2 aprovado): eixo Y em $/unit com
// gridlines, eixo X com datas reais, par tracejado como referência, REALIZADO sólido
// (início → hoje) × PROJEÇÃO pontilhada (hoje → fim). Server component puro (SVG).
// Usado no card do investidor, no drill e no report mensal — sempre a mesma leitura.

const W = 460;
const H = 150;
const X0 = 56; // margem p/ labels do Y
const X1 = 446;
const Y0 = 16;
const Y1 = 118;
const XAXIS = 130;

function niceStep(range: number) {
  const raw = range / 3;
  const pow = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * pow) return m * pow;
  return 10 * pow;
}

export function UnitValueChart({
  par,
  todayValue,
  endValue,
  startLabel,
  todayLabel,
  endLabel,
  parLabel,
  caption,
  projectionColor = "#1f3a5f",
}: {
  par: number;
  todayValue: number | null;
  endValue: number | null;
  startLabel: string;
  todayLabel: string;
  endLabel: string;
  parLabel: string; // ex.: "par $1,000"
  caption: string; // legenda abaixo do gráfico
  projectionColor?: string;
}) {
  const values = [par, todayValue ?? par, endValue ?? par];
  const step = niceStep(Math.max(...values) - Math.min(...values) || par * 0.2);
  const lo = Math.floor((Math.min(...values) - step * 0.3) / step) * step;
  const hi = Math.ceil((Math.max(...values) + step * 0.3) / step) * step;
  const y = (v: number) => Y1 - ((v - lo) / (hi - lo || 1)) * (Y1 - Y0);
  const grid: number[] = [];
  for (let v = lo; v <= hi + 0.01; v += step) grid.push(Math.round(v));
  const fmt = (v: number) =>
    `$${Math.round(v).toLocaleString("en-US")}`;

  const xStart = X0 + 16;
  const xToday = X0 + (X1 - X0) * 0.52;
  const xEnd = X1 - 18;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={caption}>
        {/* gridlines + labels Y ($/unit) */}
        {grid.map((v) => (
          <g key={v}>
            <line x1={X0} y1={y(v)} x2={X1} y2={y(v)} stroke="#eef1f6" strokeWidth={1} />
            <text x={X0 - 5} y={y(v) + 3} fill="#94a3b8" fontSize={8.5} textAnchor="end">
              {fmt(v)}
            </text>
          </g>
        ))}
        {/* par tracejado */}
        <line x1={X0} y1={y(par)} x2={X1} y2={y(par)} stroke="#94a3b8" strokeWidth={1} strokeDasharray="4 3" />
        <text x={X1} y={y(par) - 3} fill="#94a3b8" fontSize={8} textAnchor="end">
          {parLabel}
        </text>
        {/* realizado: início (par) → hoje */}
        {todayValue != null && (
          <>
            <polyline
              points={`${xStart},${y(par)} ${xToday},${y(todayValue)}`}
              fill="none"
              stroke="#1f3a5f"
              strokeWidth={2.5}
            />
            <circle cx={xStart} cy={y(par)} r={3} fill="#1f3a5f" />
            <circle cx={xToday} cy={y(todayValue)} r={3.5} fill="#1f3a5f" />
            <text x={xToday} y={y(todayValue) + (todayValue <= par ? 13 : -7)} fill="#334155" fontSize={9} fontWeight={700} textAnchor="middle">
              {fmt(todayValue)}
            </text>
          </>
        )}
        {/* projeção: hoje → fim (pontilhada) */}
        {todayValue != null && endValue != null && (
          <>
            <polyline
              points={`${xToday},${y(todayValue)} ${xEnd},${y(endValue)}`}
              fill="none"
              stroke={projectionColor}
              strokeWidth={2}
              strokeDasharray="5 4"
              opacity={0.8}
            />
            <circle cx={xEnd} cy={y(endValue)} r={3} fill={projectionColor} opacity={0.8} />
            <text x={xEnd} y={y(endValue) - 7} fill="#334155" fontSize={9} fontWeight={700} textAnchor="middle">
              ≈ {fmt(endValue)}
            </text>
          </>
        )}
        <text x={xStart} y={y(par) - 7} fill="#334155" fontSize={9} fontWeight={700} textAnchor="middle">
          {fmt(par)}
        </text>
        {/* eixo X: datas */}
        <line x1={X0} y1={XAXIS} x2={X1} y2={XAXIS} stroke="#e2e8f0" />
        <text x={xStart} y={XAXIS + 12} fill="#94a3b8" fontSize={9} textAnchor="middle">
          {startLabel}
        </text>
        <text x={xToday} y={XAXIS + 12} fill="#94a3b8" fontSize={9} textAnchor="middle">
          {todayLabel}
        </text>
        <text x={xEnd} y={XAXIS + 12} fill="#94a3b8" fontSize={9} textAnchor="middle">
          {endLabel}
        </text>
      </svg>
      <p className="mt-0.5 text-[10px] text-slate-400">{caption}</p>
    </div>
  );
}
