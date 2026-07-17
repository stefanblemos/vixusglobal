"use client";

import { useActionState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  applyLoanDoc,
  archiveLoanDoc,
  deleteLoanDoc,
  reclassifyLoanDoc,
  uploadLoanDocument,
  type FormState,
} from "@/lib/actions/pool-loan";
import type { LoanDocProposalItem } from "@/lib/pools/loan-doc-apply";

// Documentos do financiamento (mock aprovado 16/07): pasta POR LOAN dentro do pool.
// O documento propõe, você revisa e aplica — e tudo continua editável nos forms depois.

const inputClass =
  "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-[#1f3a5f] focus:ring-2 focus:ring-[#1f3a5f]/20";
const labelClass = "mb-1 block text-xs font-medium text-slate-500";

const KIND_OPTIONS: Array<[string, string]> = [
  ["LOI", "LOI / Term sheet"],
  ["AGREEMENT", "Contrato do loan (agreement)"],
  ["NOTE", "Promissory note"],
  ["SETTLEMENT", "Settlement / closing statement"],
  ["DRAW", "Draw (aprovação / liberação)"],
  ["STATEMENT", "Extrato mensal do banco"],
  ["OTHER", "Outro (só arquivar)"],
];

const KIND_CHIP: Record<string, { label: string; cls: string }> = {
  LOI: { label: "LOI", cls: "bg-blue-50 text-blue-700" },
  AGREEMENT: { label: "Contrato", cls: "bg-emerald-50 text-emerald-700" },
  NOTE: { label: "Note", cls: "bg-emerald-50 text-emerald-700" },
  SETTLEMENT: { label: "Settlement", cls: "bg-violet-50 text-violet-700" },
  DRAW: { label: "Draw", cls: "bg-amber-50 text-amber-800" },
  STATEMENT: { label: "Extrato", cls: "bg-sky-50 text-sky-700" },
  OTHER: { label: "Outro", cls: "bg-slate-100 text-slate-500" },
};

export type LoanDocRow = {
  id: string;
  kind: string;
  fileName: string;
  date: string;
  sizeKb: number;
  summary: string | null;
  appliedSummary: string | null;
  applied: boolean;
  pending: LoanDocProposalItem[] | null; // proposta aguardando revisão
  extractedJson: string | null;
};

export function PoolLoanDocs({
  poolId,
  loanId,
  loanLabel,
  docs,
}: {
  poolId: string;
  loanId: string;
  loanLabel: string;
  docs: LoanDocRow[];
}) {
  const [upState, uploadAction, uploading] = useActionState<FormState, FormData>(
    uploadLoanDocument.bind(null, poolId),
    undefined,
  );
  const router = useRouter();
  useEffect(() => {
    if (upState?.ok) router.refresh();
  }, [upState, router]);

  const pending = docs.filter((d) => d.pending && d.pending.length > 0);

  return (
    <section className="rounded-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-100 px-5 py-4">
        <h2 className="text-base font-medium text-slate-800">📁 Documentos — {loanLabel}</h2>
        <p className="text-xs text-slate-400">
          O documento é a fonte: a IA extrai conforme o tipo, você revisa a proposta antes de
          aplicar, e o arquivo fica guardado no pool. Tudo continua editável nos Termos do loan e
          no statement (corrigir leitura ou detalhes).
        </p>
      </div>

      <div className="space-y-4 px-5 py-4">
        {/* upload */}
        <form
          action={uploadAction}
          className="flex flex-wrap items-end gap-3 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-4"
        >
          <input type="hidden" name="loanId" value={loanId} />
          <div className="min-w-56 flex-1">
            <label className={labelClass}>Documentos (PDF — pode selecionar vários)</label>
            <input name="file" type="file" accept="application/pdf" multiple required className={inputClass} />
          </div>
          <div className="w-64">
            <label className={labelClass}>Tipo</label>
            <select name="kind" defaultValue="AUTO" className={inputClass}>
              <option value="AUTO">Auto — a leitura identifica</option>
              {KIND_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={uploading}
            className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-medium text-white hover:bg-[#16304f] disabled:opacity-60"
          >
            {uploading ? "Analisando com AI… (~1min)" : "↑ Ler com AI"}
          </button>
          <p className="w-full text-[11px] text-slate-400">
            Cada upload SOMA ao arquivo do loan — nada substitui nada (LOI, contrato, note,
            settlement, draws e extratos convivem). Em &quot;Auto&quot; a leitura identifica o
            tipo; se ficar em dúvida, o documento entra como &quot;Outro&quot; e você ajusta na
            lista. LOI aplica direto ao banco + loan; os demais geram proposta revisável.
          </p>
          {upState?.error && <p className="w-full text-sm text-red-600">{upState.error}</p>}
        </form>

        {/* propostas pendentes */}
        {pending.map((d) => (
          <ProposalPanel key={d.id} poolId={poolId} doc={d} />
        ))}

        {/* arquivo do loan */}
        {docs.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-slate-100">
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400" style={{ width: "30%" }}>Documento</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Tipo</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Data</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Resumo (AI)</th>
                  <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-400">Efeito</th>
                  <th className="px-2 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {docs.map((d) => (
                  <tr key={d.id} className="border-b border-slate-50 align-top">
                    <td className="px-3 py-2">
                      <a
                        href={`/api/loan-docs/${d.id}/pdf`}
                        target="_blank"
                        className="text-sm font-semibold text-[#1f3a5f] hover:underline"
                      >
                        {d.fileName}
                      </a>
                      <div className="text-[10.5px] text-slate-400">{d.sizeKb} KB</div>
                    </td>
                    <td className="px-3 py-2">
                      <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-bold ${KIND_CHIP[d.kind]?.cls ?? ""}`}>
                        {KIND_CHIP[d.kind]?.label ?? d.kind}
                      </span>
                      <ReclassifyControl poolId={poolId} doc={d} />
                    </td>
                    <td className="px-3 py-2 text-xs text-slate-500">{d.date}</td>
                    <td className="px-3 py-2 text-xs text-slate-400">{d.summary ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">
                      {d.applied ? (
                        <span className="font-semibold text-emerald-700">✓ {d.appliedSummary}</span>
                      ) : d.pending && d.pending.length > 0 ? (
                        <span className="font-semibold text-amber-700">proposta aguardando revisão ↑</span>
                      ) : (
                        <span className="text-slate-400">{d.appliedSummary ?? "arquivado (sem leitura)"}</span>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right">
                      <div className="flex items-center justify-end gap-2 whitespace-nowrap">
                        {d.extractedJson && (
                          <details className="relative inline-block text-left">
                            <summary className="cursor-pointer text-[11px] text-[#1f3a5f] underline">extração</summary>
                            <div className="absolute right-0 z-10 mt-1 max-h-72 w-96 overflow-auto rounded-lg border border-slate-200 bg-white p-3 shadow-lg">
                              <pre className="whitespace-pre-wrap text-[10px] text-slate-600">
                                {JSON.stringify(JSON.parse(d.extractedJson), null, 1)}
                              </pre>
                            </div>
                          </details>
                        )}
                        <form action={deleteLoanDoc}>
                          <input type="hidden" name="docId" value={d.id} />
                          <input type="hidden" name="poolId" value={poolId} />
                          <button type="submit" className="text-xs text-slate-300 hover:text-red-500" title="Apagar documento (não desfaz o que já foi aplicado)">
                            ✕
                          </button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="rounded-lg border border-dashed border-slate-300 px-4 py-4 text-center text-xs text-slate-400">
            Nenhum documento ainda — comece pelo LOI ou pelo contrato do loan.
          </p>
        )}
      </div>
    </section>
  );
}

// ajuste de tipo (17/07): quando a classificação erra/não identifica, o select relê o PDF
// guardado com o tipo escolhido e atualiza a mesma linha — nada é apagado do arquivo
function ReclassifyControl({ poolId, doc }: { poolId: string; doc: LoanDocRow }) {
  const [state, action, pending] = useActionState<FormState, FormData>(
    reclassifyLoanDoc.bind(null, poolId),
    undefined,
  );
  const router = useRouter();
  useEffect(() => {
    if (state?.ok) router.refresh();
  }, [state, router]);
  return (
    <form action={action} className="mt-1 flex items-center gap-1">
      <input type="hidden" name="docId" value={doc.id} />
      <select
        name="kind"
        defaultValue={doc.kind}
        className="rounded border border-slate-200 px-1 py-0.5 text-[10px] text-slate-500"
        title="Ajustar o tipo — relê o PDF com o tipo escolhido"
      >
        {KIND_OPTIONS.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <button
        type="submit"
        disabled={pending}
        className="text-[10px] text-[#1f3a5f] hover:underline disabled:opacity-50"
        title="Reler o documento com o tipo escolhido"
      >
        {pending ? "relendo…" : "↻ reler"}
      </button>
      {state?.error && <span className="text-[10px] text-red-600">{state.error}</span>}
    </form>
  );
}

// painel da proposta: checkbox por item, valor atual → novo e onde a aplicação escreve
function ProposalPanel({ poolId, doc }: { poolId: string; doc: LoanDocRow }) {
  const [state, applyAction, applying] = useActionState<FormState, FormData>(
    applyLoanDoc.bind(null, poolId),
    undefined,
  );
  const [archState, archiveAction, archiving] = useActionState<FormState, FormData>(
    archiveLoanDoc.bind(null, poolId),
    undefined,
  );
  const router = useRouter();
  useEffect(() => {
    if (state?.ok || archState?.ok) router.refresh();
  }, [state, archState, router]);

  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/50 p-4">
      <p className="mb-2 text-sm font-semibold text-slate-800">
        Proposta do documento: <span className="text-[#1f3a5f]">{doc.fileName}</span>
      </p>
      <form action={applyAction}>
        <input type="hidden" name="docId" value={doc.id} />
        <div className="divide-y divide-dashed divide-blue-100">
          {doc.pending!.map((it) => (
            <label key={it.key} className="grid cursor-pointer grid-cols-[20px_1fr_auto] items-start gap-2 py-1.5 text-sm">
              <input type="checkbox" name="keys" value={it.key} defaultChecked={it.defaultOn} className="mt-0.5" />
              <span className="text-slate-700">
                {it.from != null && <span className="mr-1 text-[11px] text-slate-400 line-through">{it.from}</span>}
                {it.label}
              </span>
              <span className="text-right text-[10.5px] text-slate-500">{it.target}</span>
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="submit"
            disabled={applying}
            className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm font-semibold text-white hover:bg-[#16304f] disabled:opacity-60"
          >
            {applying ? "Aplicando…" : "Aplicar selecionados"}
          </button>
          <button
            type="submit"
            formAction={archiveAction}
            disabled={archiving}
            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-60"
          >
            Só arquivar
          </button>
          <span className="text-[11px] text-slate-400">
            Nada é aplicado às cegas — o documento propõe, você confirma. Depois, tudo continua
            editável nos Termos e no statement.
          </span>
        </div>
        {(state?.error || archState?.error) && (
          <p className="mt-2 text-sm text-red-600">{state?.error ?? archState?.error}</p>
        )}
      </form>
    </div>
  );
}
