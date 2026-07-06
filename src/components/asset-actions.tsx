"use client";

import { useEffect, useState, type ReactNode } from "react";
import { AssetCreateForm } from "./asset-create-form";
import { AssetDetect } from "./asset-detect";
import { dedupeAssets } from "@/lib/actions/assets";
import type { DetectedAsset, DetectDiag } from "@/lib/assets/detect";

type Detected = { assets: DetectedAsset[]; bsLabel: string | null; hasGl: boolean; diag: DetectDiag | null };

// Barra de ações da aba "Ativos": botões que abrem Adicionar e Detectar em modal, e o
// remover-duplicados. Mantém o topo enxuto — a lista de ativos fica logo abaixo.
export function AssetActions({
  formCompanies,
  usCompanies,
  detected,
  detectCompanyId,
  hasAssets,
}: {
  formCompanies: { id: string; legalName: string; jurisdiction: string; baseCurrency: string }[];
  usCompanies: { id: string; legalName: string }[];
  detected: Detected | null;
  detectCompanyId: string;
  hasAssets: boolean;
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [showDetect, setShowDetect] = useState(!!detected); // reabre após o Detectar (GET)

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        onClick={() => setShowDetect(true)}
        className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f]"
      >
        Detect from QBO
      </button>
      <button
        onClick={() => setShowAdd(true)}
        className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
      >
        Add asset
      </button>
      {hasAssets && (
        <form action={dedupeAssets} className="ml-auto flex items-center gap-2 text-xs text-slate-500">
          <span className="hidden sm:inline">keeps one of each (name/date/cost)</span>
          <button className="rounded-lg border border-slate-300 px-3 py-1.5 hover:bg-slate-100">
            Remove duplicates
          </button>
        </form>
      )}

      {showAdd && (
        <Modal title="Add asset" onClose={() => setShowAdd(false)}>
          <AssetCreateForm companies={formCompanies} />
        </Modal>
      )}
      {showDetect && (
        <Modal title="Detect assets from QBO" onClose={() => setShowDetect(false)}>
          <AssetDetect companies={usCompanies} detected={detected} detectCompanyId={detectCompanyId} />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:pt-16"
      onClick={onClose}
    >
      <div className="w-full max-w-2xl rounded-xl bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <span className="text-sm font-medium text-slate-700">{title}</span>
          <button onClick={onClose} aria-label="Close" className="rounded-lg px-2 py-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            ✕
          </button>
        </div>
        <div className="max-h-[78vh] overflow-y-auto p-4 text-left">{children}</div>
      </div>
    </div>
  );
}
