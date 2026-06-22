import Link from "next/link";
import { prisma } from "@/lib/db";
import { ImportForm } from "@/components/import-form";

// GLs grandes (50k+ linhas) levam tempo para importar — eleva o limite de execução
// da rota (Server Actions herdam o maxDuration do segmento). Vercel Pro permite até 300s.
export const maxDuration = 300;
import { ImageImportForm } from "@/components/image-import-form";
import { deleteQboImport } from "@/lib/actions/qbo";
import {
  CoverageMatrix,
  type DocType,
  type MatrixRow,
  type MatrixCell,
} from "@/components/coverage-matrix";

// Ano de um período do QBO ("As of Dec 31, 2021" / "January-December, 2021").
const yearOf = (label: string): number | null => {
  const m = label.match(/(20\d\d)/);
  return m ? Number(m[1]) : null;
};

const kindToType: Record<string, DocType> = {
  BALANCE_SHEET: "BS",
  PROFIT_AND_LOSS: "PL",
  GENERAL_LEDGER: "GL",
};

type Doc = {
  type: DocType;
  year: number | null;
  label: string;
  href: string;
  deletableQbo?: string;
};

export default async function DocumentsPage() {
  const [companies, qboImports, taxReturns, bankStatements, yearCloses] = await Promise.all([
    prisma.company.findMany({ select: { id: true, legalName: true } }),
    prisma.qboImport.findMany({
      select: { id: true, companyId: true, reportKind: true, periodLabel: true },
    }),
    prisma.taxReturn.findMany({
      where: { companyId: { not: null } },
      select: {
        id: true,
        companyId: true,
        year: true,
        taxForm: true,
        fileName: true,
        pdfSize: true,
      },
    }),
    prisma.bankStatement.findMany({
      select: { id: true, companyId: true, periodEnd: true, bankLabel: true },
    }),
    prisma.yearClose.findMany({ select: { companyId: true, year: true } }),
  ]);

  const nameById = new Map(companies.map((c) => [c.id, c.legalName]));
  const docsByCompany = new Map<string, Doc[]>();
  const push = (companyId: string | null, doc: Doc) => {
    if (!companyId) return;
    const arr = docsByCompany.get(companyId) ?? [];
    arr.push(doc);
    docsByCompany.set(companyId, arr);
  };

  for (const i of qboImports) {
    const type = kindToType[i.reportKind];
    if (!type) continue;
    push(i.companyId, {
      type,
      year: yearOf(i.periodLabel),
      label: i.periodLabel,
      href: `/import/${i.id}`,
      deletableQbo: i.id,
    });
  }
  for (const t of taxReturns) {
    push(t.companyId, {
      type: "IR",
      year: t.year,
      label: `${t.taxForm ?? "Tax return"}${t.year ? ` ${t.year}` : ""}`,
      href: t.pdfSize != null ? `/api/tax-returns/${t.id}/pdf` : `/tax`,
    });
  }
  for (const b of bankStatements) {
    const y = b.periodEnd ? b.periodEnd.getUTCFullYear() : null;
    push(b.companyId, {
      type: "BANK",
      year: y,
      label: `${b.bankLabel}${y ? ` ${y}` : ""}`,
      href: `/bank/${b.id}`,
    });
  }

  const lockedByCompany = new Map<string, Set<number>>();
  for (const yc of yearCloses) {
    const s = lockedByCompany.get(yc.companyId) ?? new Set<number>();
    s.add(yc.year);
    lockedByCompany.set(yc.companyId, s);
  }

  // Anos com pelo menos um documento (para esconder colunas vazias por padrão).
  const yearsWithDocs = new Set<number>();
  for (const docs of docsByCompany.values())
    for (const d of docs) if (d.year != null) yearsWithDocs.add(d.year);
  const nonEmptyYears = [...yearsWithDocs].sort((a, b) => a - b);
  const currentYear = new Date().getFullYear();
  const minY = nonEmptyYears[0] ?? currentYear;
  const maxY = Math.max(nonEmptyYears[nonEmptyYears.length - 1] ?? currentYear, currentYear);
  const allYears: number[] = [];
  for (let y = minY; y <= maxY; y++) allYears.push(y);

  // Linhas da matriz: empresas com ≥1 doc, mais histórico no topo.
  const rows = [...docsByCompany.entries()]
    .map(([companyId, docs]) => {
      const cells: Record<number, MatrixCell> = {};
      const locks = lockedByCompany.get(companyId) ?? new Set<number>();
      for (const d of docs) {
        if (d.year == null) continue;
        const cell = (cells[d.year] ??= {
          docs: [],
          locked: locks.has(d.year),
          href: `/companies/${companyId}/year/${d.year}`,
        });
        if (!cell.docs.includes(d.type)) cell.docs.push(d.type);
      }
      const distinctYears = new Set(docs.map((d) => d.year).filter((y) => y != null)).size;
      return {
        id: companyId,
        name: nameById.get(companyId) ?? "—",
        cells,
        _docs: docs,
        _rank: distinctYears,
      };
    })
    .sort((a, b) => b._rank - a._rank || a.name.localeCompare(b.name));

  const withoutDocs = companies.length - rows.length;
  const matrixRows: MatrixRow[] = rows.map((r) => ({ id: r.id, name: r.name, cells: r.cells }));

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800">Documents</h1>
        <p className="text-sm text-slate-500">
          Every document on file, by company and year — QuickBooks reports, tax returns and bank
          statements. Upload a QuickBooks Balance Sheet, Profit &amp; Loss or General Ledger (CSV or
          .xlsx).
        </p>
      </div>

      <ImportForm />

      <details className="rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer px-5 py-3 text-sm font-medium text-slate-700">
          Import from an image / PDF (closed company, no QBO export)
        </summary>
        <div className="border-t border-slate-100 p-5">
          <ImageImportForm />
        </div>
      </details>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label="Companies with docs" value={rows.length} />
        <Metric label="QBO reports" value={qboImports.length} />
        <Metric label="Tax returns" value={taxReturns.length} />
        <Metric label="Years locked" value={yearCloses.length} />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          No documents yet.
        </div>
      ) : (
        <>
          <CoverageMatrix
            allYears={allYears}
            nonEmptyYears={nonEmptyYears.length > 0 ? nonEmptyYears : allYears}
            rows={matrixRows}
          />

          <section className="space-y-2">
            <h2 className="text-lg font-medium text-slate-800">By company</h2>
            {withoutDocs > 0 && (
              <p className="text-xs text-slate-400">
                {withoutDocs} registered {withoutDocs === 1 ? "company has" : "companies have"} no
                documents yet.
              </p>
            )}
            <div className="space-y-2">
              {rows.map((r) => (
                <CompanyDrill key={r.id} id={r.id} name={r.name} docs={r._docs} />
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}

const TYPE_LABEL: Record<DocType, string> = {
  BS: "Balance sheet",
  PL: "Profit & loss",
  GL: "General ledger",
  IR: "Income tax return",
  BANK: "Bank statements",
};
const TYPE_ORDER: DocType[] = ["BS", "PL", "GL", "IR", "BANK"];

function CompanyDrill({ id, name, docs }: { id: string; name: string; docs: Doc[] }) {
  const byType = new Map<DocType, Doc[]>();
  for (const d of docs) {
    const arr = byType.get(d.type) ?? [];
    arr.push(d);
    byType.set(d.type, arr);
  }
  const summary = TYPE_ORDER.filter((t) => byType.has(t))
    .map((t) => `${byType.get(t)!.length} ${t}`)
    .join(" · ");

  return (
    <details className="overflow-hidden rounded-xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer items-center gap-2 px-4 py-3">
        <span className="font-medium text-slate-800">{name}</span>
        <span className="text-xs text-slate-400">{summary}</span>
      </summary>
      <div className="border-t border-slate-100 px-4 py-2">
        {TYPE_ORDER.map((t) => {
          const items = (byType.get(t) ?? []).slice().sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
          return (
            <div
              key={t}
              className="flex items-start gap-3 border-t border-slate-50 py-2 first:border-t-0"
            >
              <span className="w-32 shrink-0 text-sm text-slate-600">{TYPE_LABEL[t]}</span>
              <div className="flex flex-wrap items-center gap-1.5">
                {items.length === 0 ? (
                  <span className="text-xs text-amber-600">none on file</span>
                ) : (
                  items.map((d, i) => (
                    <span key={i} className="inline-flex items-center">
                      <Link
                        href={d.href}
                        className="rounded-l-md border border-slate-200 px-2 py-0.5 text-xs text-[#1f3a5f] hover:bg-slate-50"
                        {...(d.href.startsWith("/api/")
                          ? { target: "_blank", rel: "noopener" }
                          : {})}
                      >
                        {d.label}
                      </Link>
                      {d.deletableQbo ? (
                        <form action={deleteQboImport}>
                          <input type="hidden" name="id" value={d.deletableQbo} />
                          <button
                            className="rounded-r-md border border-l-0 border-slate-200 px-1.5 py-0.5 text-xs text-slate-300 hover:text-red-600"
                            title="Delete import"
                          >
                            ×
                          </button>
                        </form>
                      ) : (
                        <span className="rounded-r-md border border-l-0 border-slate-200 px-1.5 py-0.5 text-xs text-transparent">
                          ×
                        </span>
                      )}
                    </span>
                  ))
                )}
              </div>
            </div>
          );
        })}
      </div>
    </details>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3">
      <div className="text-sm text-slate-500">{label}</div>
      <div className="text-2xl font-semibold text-slate-800">{value}</div>
    </div>
  );
}
