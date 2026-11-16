import Link from "next/link";
import type { ReactNode } from "react";
import { CompanySelect } from "@/components/company-select";

const TABS = [
  ["invoices", "Invoices"],
  ["shipments", "Shipments"],
  ["items", "Items & prices"],
  ["stock", "Stock"],
  ["month-end", "Month-end"],
  ["settings", "Settings"],
] as const;

export const money = (v: number | null | undefined, d = 2) => (v == null ? "—" : (v < 0 ? "−" : "") + "$" + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d }));
export const money0 = (v: number | null | undefined) => money(v, 0);
export const pct1 = (v: number | null | undefined) => (v == null ? "—" : (v * 100).toFixed(1) + "%");
export const br = (d: Date | string | null | undefined) => {
  if (!d) return "—";
  const s = typeof d === "string" ? d : d.toISOString().slice(0, 10);
  const [y, m, dd] = s.split("-");
  return `${dd}/${m}/${y}`;
};
export const mesBr = (m: string) => {
  const [y, mo] = m.split("-");
  return ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][Number(mo) - 1] + "/" + y.slice(2);
};
export const pill = (kind: "ok" | "warn" | "bad" | "info" | "off", text: string) => {
  const cls = { ok: "bg-emerald-50 text-emerald-700", warn: "bg-amber-50 text-amber-700", bad: "bg-red-50 text-red-700", info: "bg-blue-50 text-blue-700", off: "bg-slate-100 text-slate-500" }[kind];
  return <span className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${cls}`}>{text}</span>;
};
export const card = "rounded-xl border border-slate-200 bg-white px-5 py-4";
export const h2 = "mb-3 text-xs font-semibold uppercase tracking-wider text-[#1f3a5f]";
export const th = "px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wider text-slate-400";
export const thr = `${th} text-right`;
export const td = "px-2 py-1.5 align-top";
export const tdr = `${td} text-right tabular-nums whitespace-nowrap`;

export function Kpi({ k, v, h }: { k: string; v: ReactNode; h?: ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white px-4 py-3">
      <div className="text-[10px] uppercase tracking-wider text-slate-400">{k}</div>
      <div className="mt-0.5 text-lg font-extrabold text-slate-900">{v}</div>
      {h && <div className="text-[11px] text-slate-500">{h}</div>}
    </div>
  );
}

export function InventoryShell({
  tab,
  companies,
  companyId,
  companyName,
  glUntil,
  children,
}: {
  tab: (typeof TABS)[number][0];
  companies: { id: string; legalName: string }[];
  companyId: string | null;
  companyName: string | null;
  glUntil: Date | null;
  children: ReactNode;
}) {
  const q = companyId ? `?company=${companyId}` : "";
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="text-xs text-slate-500">Inventory · importação de material</div>
          <h1 className="text-2xl font-semibold text-slate-800">{companyName ?? "Escolha a empresa"}</h1>
          <p className="text-xs text-slate-500">
            {glUntil ? <>GL do QBO carregado até <b>{br(glUntil)}</b></> : "GL do QBO ainda não carregado para esta empresa"} · régua do estoque em valor; quantidade não vem do GL.
          </p>
        </div>
        <CompanySelect options={[{ value: "", label: "Empresa…" }, ...companies.map((c) => ({ value: c.id, label: c.legalName }))]} value={companyId ?? ""} basePath={`/inventory/${tab}`} />
      </div>
      <nav className="flex gap-1 border-b border-slate-200">
        {TABS.map(([key, label]) => (
          <Link key={key} href={`/inventory/${key}${q}`} className={`-mb-px border-b-2 px-3 py-2 text-sm ${tab === key ? "border-[#1f3a5f] font-semibold text-[#1f3a5f]" : "border-transparent text-slate-500 hover:text-slate-800"}`}>
            {label}
          </Link>
        ))}
      </nav>
      {companyId ? children : <p className="text-sm text-slate-500">Selecione a empresa acima.</p>}
    </div>
  );
}
