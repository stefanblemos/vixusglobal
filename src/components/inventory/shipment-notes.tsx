import { ActionForm } from "./action-form";
import { pill } from "./inventory-shell";
import { analyzeShipmentNotesAction } from "@/lib/actions/inventory";

type Ship = { id: string; aiStatus: string | null; aiNote: string | null; aiPending: string[]; aiContingent: string[]; aiAt: Date | null; aiHash: string | null };

/**
 * Nota do Claude sobre os memos do embarque: o que já foi cobrado × o que as invoices dizem
 * "NOT included". `hash` é o hash atual das invoices; diferente do gravado = nota desatualizada.
 */
export function ShipmentNotes({ sh, hash, closed }: { sh: Ship; hash: string; closed: boolean }) {
  const stale = !!sh.aiHash && sh.aiHash !== hash;
  const st = sh.aiStatus;
  const tone = st === "COMPLETE" ? "bg-emerald-50 text-emerald-800" : st === "PENDING" ? "bg-amber-50 text-amber-900" : "bg-slate-50 text-slate-700";
  const when = sh.aiAt ? sh.aiAt.toISOString().slice(0, 10).split("-").reverse().join("/") : null;
  return (
    <div className={`mt-2 rounded-lg px-3 py-2 text-xs ${sh.aiNote ? tone : "bg-slate-50 text-slate-600"}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Notas das invoices</span>
        {st === "COMPLETE" && pill("ok", "tudo cobrado")}
        {st === "PENDING" && pill("warn", "falta cobrar")}
        {st === "UNCLEAR" && pill("off", "notas sem conclusão")}
        {stale && pill("bad", "invoices mudaram · reler")}
        {when && <span className="text-[10px] opacity-70">lido em {when}</span>}
        {!closed && (
          <ActionForm action={analyzeShipmentNotesAction} submitLabel={sh.aiNote ? "Reler notas" : "Ler notas (Claude)"} submitClass="rounded border border-current px-2 py-0.5 text-[11px] font-semibold opacity-80 hover:opacity-100" className="ml-auto">
            <input type="hidden" name="shipmentId" value={sh.id} />
          </ActionForm>
        )}
      </div>
      {sh.aiNote ? (
        <>
          <p className="mt-1">{sh.aiNote}</p>
          {sh.aiPending.length > 0 && <p className="mt-1"><b>Ainda deve vir:</b> {sh.aiPending.join(" · ")}</p>}
          {sh.aiContingent.length > 0 && <p className="mt-1 opacity-80"><b>Eventuais (só se ocorrer, não seguram o fechamento):</b> {sh.aiContingent.join(" · ")}</p>}
        </>
      ) : (
        <p className="mt-1 opacity-80">O Claude lê as notas de todas as invoices do embarque na ordem de emissão (“… NOT included” nas antigas, cobrado nas seguintes) e diz o que já foi cobrado e o que ainda falta.</p>
      )}
    </div>
  );
}
