import { buildIrReconciliation } from "@/lib/tax/audit-vs-ir";
import { buildObligationCalendar } from "@/lib/obligations/calendar";

// DIGEST DE ALERTAS: junta num só lugar o que precisa de atenção — divergências vs IR, IR faltando,
// estadual sem cadastro, ativo sem depreciação, obrigações vencidas/a vencer. É o conteúdo que um
// e-mail semanal empurraria (a entrega por e-mail é o passo de infra seguinte). Prioriza por severidade.

export type Severity = "alta" | "media" | "baixa";
export interface Alert {
  severity: Severity;
  category: string;
  title: string;
  detail: string;
  href: string;
}
export interface Digest {
  year: number;
  years: number[];
  alerts: Alert[];
  counts: { alta: number; media: number; baixa: number };
}

const M = (n: number) => "$" + Math.round(Math.abs(n)).toLocaleString("en-US");

export async function buildDigest(year: number): Promise<Digest> {
  const [recon, obl] = await Promise.all([
    buildIrReconciliation(year),
    buildObligationCalendar(year).catch(() => null),
  ]);
  const alerts: Alert[] = [];

  for (const r of recon.rows) {
    // divergência de base tributável vs IR
    const tax = r.metrics.find((m) => m.key === "taxable");
    if (r.severity === "diverge" && tax && tax.status === "diverge" && tax.diff != null) {
      alerts.push({
        severity: "alta", category: "Conferência IR",
        title: `${r.name}: base tributável diverge do IR`,
        detail: `Preview ${M(tax.preview ?? 0)} vs IR ${M(tax.ir ?? 0)} (Δ ${M(tax.diff)}).`,
        href: `/tax-audit?year=${year}`,
      });
    }
    // flags (estadual sem cadastro, depreciação sem ativo, etc.)
    for (const f of r.flags) {
      alerts.push({ severity: "media", category: "Conferência IR", title: `${r.name}`, detail: f, href: `/tax-audit?year=${year}` });
    }
    // tem QBO mas não tem IR do ano para conferir
    if (r.severity === "no-ir") {
      alerts.push({
        severity: "media", category: "IR faltando",
        title: `${r.name}: sem IR de ${year}`,
        detail: `Há QBO mas não há a declaração para conferir. Subir o IR destrava a conferência e a base distribuível.`,
        href: `/tax`,
      });
    }
  }

  if (obl) {
    // Só obrigações ACIONÁVEIS: vencidas há pouco (≤90 dias) ou a vencer (≤45 dias). Sem isso, um ano
    // passado inunda o digest com obrigações "vencidas" de anos atrás — histórico, não ação.
    const now = Date.now();
    const soon = now + 45 * 86_400_000;
    const staleCut = now - 90 * 86_400_000;
    for (const i of obl.instances) {
      if (i.status !== "PENDING") continue;
      const due = new Date(i.dueDate).getTime();
      if (i.overdue && due >= staleCut) {
        alerts.push({ severity: "alta", category: "Obrigação", title: `${i.companyName}: ${i.name} VENCIDA`, detail: `Venceu em ${i.dueDate} (${i.authority}).`, href: `/obligations?year=${year}` });
      } else if (!i.overdue && due <= soon) {
        alerts.push({ severity: "media", category: "Obrigação", title: `${i.companyName}: ${i.name}`, detail: `Vence em ${i.dueDate} (${i.authority}).`, href: `/obligations?year=${year}` });
      }
    }
  }

  const rank: Record<Severity, number> = { alta: 0, media: 1, baixa: 2 };
  alerts.sort((a, b) => rank[a.severity] - rank[b.severity] || a.category.localeCompare(b.category));

  return {
    year, years: recon.years, alerts,
    counts: {
      alta: alerts.filter((a) => a.severity === "alta").length,
      media: alerts.filter((a) => a.severity === "media").length,
      baixa: alerts.filter((a) => a.severity === "baixa").length,
    },
  };
}
