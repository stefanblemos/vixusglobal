"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";
import { createDetectedAssets } from "@/lib/actions/assets";
import { ASSET_CATEGORIES } from "@/lib/assets/categories";
import type { DetectedAsset, DetectDiag } from "@/lib/assets/detect";

type Draft = DetectedAsset & { include: boolean; fullyDepreciatedYear: number | null };
type Detected = { assets: DetectedAsset[]; bsLabel: string | null; hasGl: boolean; diag: DetectDiag | null };

export function AssetDetect({
  companies,
  detected,
  detectCompanyId,
}: {
  companies: { id: string; legalName: string }[];
  detected: Detected | null;
  detectCompanyId: string;
}) {
  const [drafts, setDrafts] = useState<Draft[]>(() =>
    (detected?.assets ?? []).map((a) => ({
      ...a,
      include: !a.alreadyRegistered,
      fullyDepreciatedYear: a.suggestFullyDepreciated ? a.suggestedFullYear : null,
    })),
  );

  function patch(i: number, p: Partial<Draft>) {
    setDrafts((d) => d.map((x, k) => (k === i ? { ...x, ...p } : x)));
  }

  const selected = drafts.filter((d) => d.include);
  const inputCls = "rounded border border-slate-300 px-2 py-1 text-xs";

  return (
    <div className="space-y-3">
          <p className="text-sm text-slate-500">
            Reads the <em>Fixed Assets</em> section of the Balance Sheet (cost) and the 1st transaction
            of each account in the General Ledger (purchase date), and guesses the category from the
            name. You review and register.
          </p>

          {/* Detectar — GET para a própria página (?detect=empresa) */}
          <form action="/assets" className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">Company</span>
              <select name="detect" defaultValue={detectCompanyId || companies[0]?.id} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.legalName}</option>
                ))}
              </select>
            </label>
            <button className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]">Detect</button>
          </form>

          {detected && (
            <>
              <p className="text-xs text-slate-500">
                {detected.assets.length === 0
                  ? detected.bsLabel
                    ? "No fixed assets found in the imported BS."
                    : "No Balance Sheet imported for this company — import the BS in Documents."
                  : `${detected.assets.length} assets detected from the BS ${detected.bsLabel ? `(${detected.bsLabel})` : ""}. ${detected.hasGl ? "Dates from the GL where possible." : "No GL — dates come from the name/year."}`}
              </p>

              {detected.assets.length === 0 && detected.diag && (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <div className="mb-1 font-medium text-slate-700">BS diagnostics ({detected.bsLabel}):</div>
                  <div>Account lines: {detected.diag.accountCount} · in &ldquo;Fixed Assets&rdquo;: {detected.diag.faLineCount}</div>
                  <div className="mt-1">
                    <span className="text-slate-400">Sections in the BS:</span>{" "}
                    {detected.diag.sectionsPresent.length ? detected.diag.sectionsPresent.join(" · ") : "(none — the BS may have been imported from an image/PDF, with no section structure)"}
                  </div>
                  <div className="mt-1">
                    <span className="text-slate-400">Imported BS:</span> {detected.diag.availableBs.join(" · ") || "—"}
                  </div>
                </div>
              )}

              {drafts.length > 0 && (
                <>
                  <div className="overflow-x-auto rounded-lg border border-slate-200">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 text-left text-slate-500">
                        <tr>
                          <th className="px-2 py-2"></th>
                          <th className="px-2 py-2 font-medium">Asset</th>
                          <th className="px-2 py-2 text-right font-medium">Cost</th>
                          <th className="px-2 py-2 font-medium">In service</th>
                          <th className="px-2 py-2 font-medium">Category / life</th>
                          <th className="px-2 py-2 font-medium">Already zeroed in the book?</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {drafts.map((d, i) => (
                          <tr key={i} className={d.include ? "" : "opacity-40"}>
                            <td className="px-2 py-1.5">
                              <input type="checkbox" checked={d.include} onChange={(e) => patch(i, { include: e.target.checked })} className="h-4 w-4 rounded border-slate-300" />
                            </td>
                            <td className="px-2 py-1.5">
                              <input value={d.name} onChange={(e) => patch(i, { name: e.target.value })} className={`${inputCls} w-48`} />
                              {d.alreadyRegistered && <div className="text-[10px] text-amber-600">already registered</div>}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <input value={d.cost} onChange={(e) => patch(i, { cost: Number(e.target.value) || 0 })} className={`${inputCls} w-24 text-right tabular-nums`} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="date" value={d.acquisitionDate} onChange={(e) => patch(i, { acquisitionDate: e.target.value })} className={inputCls} />
                              <div className="text-[10px] text-slate-400">{d.acqSource === "gl" ? "from the GL" : d.acqSource === "name" ? "from the name" : "default — check"}</div>
                            </td>
                            <td className="px-2 py-1.5">
                              <select
                                value={d.category}
                                onChange={(e) => {
                                  const c = ASSET_CATEGORIES.find((x) => x.key === e.target.value)!;
                                  patch(i, { category: c.key, recoveryYears: c.recoveryYears });
                                }}
                                className={inputCls}
                              >
                                {ASSET_CATEGORIES.map((c) => (
                                  <option key={c.key} value={c.key}>{c.label} ({c.recoveryYears}yr)</option>
                                ))}
                              </select>
                            </td>
                            <td className="px-2 py-1.5">
                              <label className="flex items-center gap-1.5">
                                <input
                                  type="checkbox"
                                  checked={d.fullyDepreciatedYear != null}
                                  onChange={(e) =>
                                    patch(i, {
                                      fullyDepreciatedYear: e.target.checked
                                        ? (d.suggestedFullYear ?? (Number(d.acquisitionDate.slice(0, 4)) || null))
                                        : null,
                                    })
                                  }
                                  className="h-4 w-4 rounded border-slate-300"
                                />
                                {d.fullyDepreciatedYear != null ? (
                                  <input
                                    type="number"
                                    value={d.fullyDepreciatedYear}
                                    onChange={(e) => patch(i, { fullyDepreciatedYear: Number(e.target.value) || null })}
                                    className={`${inputCls} w-16 tabular-nums`}
                                  />
                                ) : (
                                  <span className="text-slate-400">no</span>
                                )}
                              </label>
                              {d.suggestFullyDepreciated && (
                                <div className="text-[10px] text-amber-600">accum ≈ cost — confirm</div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <form action={createDetectedAssets} className="flex items-center justify-between">
                    <input type="hidden" name="companyId" value={detectCompanyId} />
                    <input type="hidden" name="assets" value={JSON.stringify(selected)} />
                    <span className="text-xs text-slate-500">{selected.length} selected</span>
                    <SubmitButton count={selected.length} />
                  </form>
                </>
              )}
            </>
          )}
    </div>
  );
}

function SubmitButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={count === 0 || pending}
      className="rounded-lg bg-[#8DC63F] px-4 py-2 text-sm font-medium text-[#173404] hover:bg-[#7eb536] disabled:opacity-50"
    >
      {pending ? "Registering…" : `Register ${count} asset(s)`}
    </button>
  );
}
