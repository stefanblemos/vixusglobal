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
            Lê a seção <em>Fixed Assets</em> do Balance Sheet (custo) e a 1ª transação de cada conta no
            General Ledger (data da compra), e chuta a categoria pelo nome. Você confere e cadastra.
          </p>

          {/* Detectar — GET para a própria página (?detect=empresa) */}
          <form action="/assets" className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-xs font-medium text-slate-600">Empresa</span>
              <select name="detect" defaultValue={detectCompanyId || companies[0]?.id} className="rounded-lg border border-slate-300 px-3 py-2 text-sm">
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.legalName}</option>
                ))}
              </select>
            </label>
            <button className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]">Detectar</button>
          </form>

          {detected && (
            <>
              <p className="text-xs text-slate-500">
                {detected.assets.length === 0
                  ? detected.bsLabel
                    ? "Nenhum ativo de ativo fixo encontrado no BS importado."
                    : "Sem Balance Sheet importado para esta empresa — importe o BS em Documents."
                  : `${detected.assets.length} ativos detectados do BS ${detected.bsLabel ? `(${detected.bsLabel})` : ""}. ${detected.hasGl ? "Datas vindas do GL onde possível." : "Sem GL — datas vêm do nome/ano."}`}
              </p>

              {detected.assets.length === 0 && detected.diag && (
                <div className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                  <div className="mb-1 font-medium text-slate-700">Diagnóstico do BS ({detected.bsLabel}):</div>
                  <div>Linhas de conta: {detected.diag.accountCount} · em &ldquo;Fixed Assets&rdquo;: {detected.diag.faLineCount}</div>
                  <div className="mt-1">
                    <span className="text-slate-400">Seções no BS:</span>{" "}
                    {detected.diag.sectionsPresent.length ? detected.diag.sectionsPresent.join(" · ") : "(nenhuma — o BS pode ter sido importado por imagem/PDF, sem estrutura de seção)"}
                  </div>
                  <div className="mt-1">
                    <span className="text-slate-400">BS importados:</span> {detected.diag.availableBs.join(" · ") || "—"}
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
                          <th className="px-2 py-2 font-medium">Ativo</th>
                          <th className="px-2 py-2 text-right font-medium">Custo</th>
                          <th className="px-2 py-2 font-medium">Entrada em uso</th>
                          <th className="px-2 py-2 font-medium">Categoria / vida</th>
                          <th className="px-2 py-2 font-medium">Já zerado no livro?</th>
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
                              {d.alreadyRegistered && <div className="text-[10px] text-amber-600">já cadastrado</div>}
                            </td>
                            <td className="px-2 py-1.5 text-right">
                              <input value={d.cost} onChange={(e) => patch(i, { cost: Number(e.target.value) || 0 })} className={`${inputCls} w-24 text-right tabular-nums`} />
                            </td>
                            <td className="px-2 py-1.5">
                              <input type="date" value={d.acquisitionDate} onChange={(e) => patch(i, { acquisitionDate: e.target.value })} className={inputCls} />
                              <div className="text-[10px] text-slate-400">{d.acqSource === "gl" ? "do GL" : d.acqSource === "name" ? "do nome" : "padrão — confira"}</div>
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
                                  <span className="text-slate-400">não</span>
                                )}
                              </label>
                              {d.suggestFullyDepreciated && (
                                <div className="text-[10px] text-amber-600">acum ≈ custo — confirme</div>
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
                    <span className="text-xs text-slate-500">{selected.length} selecionado(s)</span>
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
      {pending ? "Cadastrando…" : `Cadastrar ${count} ativo(s)`}
    </button>
  );
}
