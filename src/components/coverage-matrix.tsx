"use client";

import { useState } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";

export type DocType = "BS" | "PL" | "GL" | "IR" | "BANK";

const CHIP: Record<DocType, { letter: string; cls: string }> = {
  BS: { letter: "B", cls: "bg-blue-50 text-blue-700" },
  PL: { letter: "P", cls: "bg-emerald-50 text-emerald-700" },
  GL: { letter: "G", cls: "bg-purple-50 text-purple-700" },
  IR: { letter: "I", cls: "bg-amber-50 text-amber-700" },
  BANK: { letter: "$", cls: "bg-rose-50 text-rose-700" },
};

const DOC_ORDER: DocType[] = ["BS", "PL", "GL", "IR", "BANK"];

export type MatrixCell = { docs: DocType[]; locked: boolean; href: string };
export type MatrixRow = { id: string; name: string; cells: Record<number, MatrixCell> };

export function CoverageMatrix({
  allYears,
  nonEmptyYears,
  rows,
}: {
  allYears: number[];
  nonEmptyYears: number[];
  rows: MatrixRow[];
}) {
  const [showAll, setShowAll] = useState(false);
  const years = showAll ? allYears : nonEmptyYears;
  const hiddenCount = allYears.length - nonEmptyYears.length;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
        <span className="font-medium text-slate-700">Coverage</span>
        {DOC_ORDER.map((d) => (
          <span key={d} className="inline-flex items-center gap-1.5">
            <span
              className={`inline-block h-4 w-4 rounded text-center text-[10px] leading-4 font-medium ${CHIP[d].cls}`}
            >
              {CHIP[d].letter}
            </span>
            {labelFor(d)}
          </span>
        ))}
        <span className="inline-flex items-center gap-1">
          <Lock size={12} className="text-emerald-600" /> locked
        </span>
        {hiddenCount > 0 && (
          <button
            onClick={() => setShowAll((v) => !v)}
            className="ml-auto rounded-lg border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
          >
            {showAll ? "Hide empty years" : `Show all years (+${hiddenCount})`}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="border-collapse text-sm" style={{ minWidth: "640px" }}>
          <thead>
            <tr className="text-slate-500">
              <th className="sticky left-0 bg-white px-3 py-2 text-left font-medium">Company</th>
              {years.map((y) => (
                <th key={y} className="px-2 py-2 font-medium" style={{ width: 64 }}>
                  {y}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="sticky left-0 bg-white px-3 py-2 font-medium whitespace-nowrap">
                  <Link href={`/companies/${r.id}`} className="text-[#1f3a5f] hover:underline">
                    {r.name}
                  </Link>
                </td>
                {years.map((y) => {
                  const cell = r.cells[y];
                  if (!cell || cell.docs.length === 0)
                    return (
                      <td key={y} className="px-2 py-2 text-center text-slate-300">
                        ·
                      </td>
                    );
                  return (
                    <td
                      key={y}
                      className={`px-2 py-2 text-center ${cell.locked ? "bg-emerald-50/40" : ""}`}
                    >
                      <Link href={cell.href} className="inline-flex items-center gap-1">
                        <span className="inline-flex flex-wrap justify-center gap-1">
                          {DOC_ORDER.filter((d) => cell.docs.includes(d)).map((d) => (
                            <span
                              key={d}
                              className={`inline-block h-[18px] w-[18px] rounded text-center text-[10px] leading-[18px] font-medium ${CHIP[d].cls}`}
                            >
                              {CHIP[d].letter}
                            </span>
                          ))}
                        </span>
                        {cell.locked && <Lock size={11} className="text-emerald-600" />}
                      </Link>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function labelFor(d: DocType) {
  return d === "BS"
    ? "Balance sheet"
    : d === "PL"
      ? "P&L"
      : d === "GL"
        ? "Ledger"
        : d === "IR"
          ? "IR"
          : "Bank";
}
