import Link from "next/link";
import { ACCOUNT_SPECS, INTERCOMPANY_NOTE, M1_LABEL, type SpecAction } from "@/lib/coa/canonical";

export const dynamic = "force-dynamic";

const ACTION: Record<SpecAction, { label: string; cls: string }> = {
  criar: { label: "criar", cls: "bg-emerald-100 text-emerald-700" },
  padronizar: { label: "padronizar", cls: "bg-sky-100 text-sky-700" },
  separar: { label: "separar", cls: "bg-amber-100 text-amber-700" },
};

export default function CoaPage() {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800">Contas a padronizar no QBO</h1>
          <p className="max-w-3xl text-sm text-slate-500">
            Você usa o plano <strong>nativo do QBO</strong> — e pode continuar. O app lê os{" "}
            <strong>totais de seção</strong> (Total Income/COGS/Expenses/Net Income; Assets/Liabilities/Equity),
            que já existem. Só estas <strong>{ACCOUNT_SPECS.length} contas</strong> precisam de ação, porque o{" "}
            <strong>nome ou a separação muda o cálculo do imposto</strong>.
          </p>
        </div>
        <Link href="/coa/guides" className="rounded-lg bg-[#1f3a5f] px-4 py-2 text-sm text-white hover:bg-[#16304f]">
          Ver guias de lançamento →
        </Link>
      </div>

      <div className="rounded-xl border border-slate-200 bg-slate-50/60 px-4 py-3 text-xs text-slate-600">
        <div className="font-medium text-slate-700">O que o app faz com suas contas filhas (sub-contas)</div>
        <p className="mt-1">
          Pode manter todas — o app soma as <strong>folhas</strong> (filhas) e ignora o total do pai (não duplica),
          e a filha <strong>herda o conceito do pai</strong> (uma sub-conta dentro de “Meals” conta como refeição
          mesmo sem “meal” no nome). Contas numeradas por empresa (bancos, “0417 (Office)”) são reais — não unificar.
        </p>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-[11px] uppercase tracking-wide text-slate-400">
            <tr>
              <th className="px-4 py-2 font-medium">Ação</th>
              <th className="px-3 py-2 font-medium">Conta padronizada</th>
              <th className="px-3 py-2 font-medium">Hoje</th>
              <th className="px-3 py-2 font-medium">Tratamento fiscal</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {ACCOUNT_SPECS.map((a) => (
              <tr key={a.name} className="align-top">
                <td className="px-4 py-2.5">
                  <span className={`rounded-full px-2 py-0.5 text-[11px] ${ACTION[a.action].cls}`}>{ACTION[a.action].label}</span>
                </td>
                <td className="px-3 py-2.5">
                  <div className="font-medium text-slate-800">{a.name}</div>
                  {a.note && <div className="text-[11px] text-slate-500">{a.note}</div>}
                  <div className="text-[10px] text-slate-400">QBO: {a.qboType} · {a.qboDetail}</div>
                </td>
                <td className="px-3 py-2.5 text-[11px] text-slate-500">{a.today}</td>
                <td className="px-3 py-2.5">
                  {a.m1 && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-800">{M1_LABEL[a.m1]}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-xl border border-sky-200 bg-sky-50/50 px-4 py-3 text-xs text-sky-900">
        <div className="font-medium">Intercompany — nomear a coligada igual em todas</div>
        <p className="mt-1">{INTERCOMPANY_NOTE.problem}</p>
        <p className="mt-1">{INTERCOMPANY_NOTE.rule}</p>
      </div>

      <p className="text-[11px] text-slate-400">
        <span className="rounded bg-emerald-100 px-1 text-emerald-700">criar</span> = conta nova ·{" "}
        <span className="rounded bg-sky-100 px-1 text-sky-700">padronizar</span> = unificar as grafias num nome só ·{" "}
        <span className="rounded bg-amber-100 px-1 text-amber-700">separar</span> = quebrar uma conta que junta dois
        tratamentos. Feito isso, o app lê e coloca cada valor no lugar certo — sem regex adivinhando.
      </p>
    </div>
  );
}
