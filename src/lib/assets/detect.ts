import { prisma } from "@/lib/db";

// Detecta ativos fixos a partir do QBO já importado, para pré-popular o cadastro:
//  • custo + nome: seção Fixed Assets do Balance Sheet (mais recente);
//  • data de entrada em uso: 1ª transação da conta do ativo no General Ledger (a compra);
//  • fallback de data: ano no próprio nome ("ALS 4.0 (2024)"), senão ano anterior;
//  • categoria/vida: chutada pelo nome (o usuário confirma);
//  • acumulada do BS (quando há "Accumulated depreciation - X" por ativo) — só p/ referência.

export interface DetectedAsset {
  name: string;
  cost: number;
  accumulated: number | null;
  acquisitionDate: string; // ISO YYYY-MM-DD
  acqSource: "gl" | "name" | "default";
  category: string;
  recoveryYears: number;
  alreadyRegistered: boolean;
}

const norm = (s: string) => s.toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").trim();

// Chute de categoria pelo nome. isParent = conta-pai de custo (ex.: "Original Cost" do imóvel) —
// nesse caso, na falta de palavra específica, assume imóvel (a construção, não o terreno).
function guessCategory(name: string, isParent = false): { category: string; recoveryYears: number } {
  const n = name.toLowerCase();
  if (/improvement|\bpool\b|backyard|landscap|\bfence\b|paving|driveway|patio|sprinkler/.test(n)) return { category: "LAND_IMP", recoveryYears: 15 };
  if (/\bland\b/.test(n)) return { category: "LAND", recoveryYears: 0 }; // terreno — não deprecia
  if (/comput|laptop|server|monitor|printer|camera|alarm|software|electronic/.test(n)) return { category: "COMPUTER", recoveryYears: 5 };
  if (/trailer|dumproller|vehicle|truck|\bcar\b|\bvan\b|forklift/.test(n)) return { category: "AUTO", recoveryYears: 5 };
  if (/furnitur|fixture|\bdesk\b|\bchair\b|cabinet|shelv/.test(n)) return { category: "FURNITURE", recoveryYears: 7 };
  if (/building|\bhouse\b|dwelling|residential|real estate|rental/.test(n)) return { category: "RESIDENTIAL_RE", recoveryYears: 27.5 };
  if (isParent) return { category: "RESIDENTIAL_RE", recoveryYears: 27.5 }; // custo-pai de imóvel
  return { category: "EQUIPMENT", recoveryYears: 7 };
}

const yearFromName = (name: string): number | null => {
  const m = name.match(/(20\d\d)/);
  return m ? Number(m[1]) : null;
};

export interface DetectDiag {
  sectionsPresent: string[]; // seções distintas no BS escolhido
  accountCount: number; // linhas ACCOUNT no BS escolhido
  faLineCount: number; // linhas em seção de ativo fixo
  availableBs: string[]; // todos os BS importados (período) — para ver qual ano tem ativo
}

// Seção de ativo fixo: "Fixed Asset(s)" e variações (Property/Plant/Equipment/Machinery/
// Vehicles/Furniture/Leasehold/Building) — exclui ativo circulante/passivo/patrimônio.
const isFixedAssetSection = (path: string[]) =>
  path.some((s) => /fixed asset/i.test(s)) ||
  (path.some((s) => /property|plant|equipment|machinery|vehicle|furniture|leasehold|building|long[- ]?term asset/i.test(s)) &&
    !path.some((s) => /current asset|bank|receivable|inventory|prepaid|payable|liabilit|equity|deposit/i.test(s)));

// Candidato a ativo (custo): conta-folha (ACCOUNT) OU conta-pai com saldo próprio (SECTION com
// valor — ex.: a casa fica no "Original Cost" que tem a filha "Closing Cost"); valor > 0, não-deprec.
type FaLine = { lineType: string; label: string; value: unknown; sectionPath: string[] };
const isCostCandidate = (l: FaLine) =>
  (l.lineType === "ACCOUNT" || l.lineType === "SECTION") &&
  isFixedAssetSection(l.sectionPath) &&
  l.value != null &&
  Number(l.value) > 0 &&
  !/depreciat/i.test(l.label);

export async function detectAssetsFromQbo(
  companyId: string,
): Promise<{ assets: DetectedAsset[]; bsLabel: string | null; hasGl: boolean; diag: DetectDiag | null }> {
  // Pode haver vários BS importados (anos diferentes, ou um import quebrado). Escolhe o que tem
  // MAIS contas de ativo fixo — não o mais recente por createdAt (que pode ser um BS antigo/vazio).
  const bsImports = await prisma.qboImport.findMany({
    where: { companyId, reportKind: "BALANCE_SHEET" },
    orderBy: { createdAt: "desc" },
    select: { id: true, periodLabel: true },
  });
  if (bsImports.length === 0) return { assets: [], bsLabel: null, hasGl: false, diag: null };

  const allLines = await prisma.qboImportLine.findMany({
    where: { importId: { in: bsImports.map((b) => b.id) } },
    select: { importId: true, label: true, value: true, lineType: true, sectionPath: true },
  });
  const linesByImport = new Map<string, typeof allLines>();
  for (const l of allLines) {
    (linesByImport.get(l.importId) ?? linesByImport.set(l.importId, []).get(l.importId)!).push(l);
  }
  const faCostCount = (ls: typeof allLines) => ls.filter(isCostCandidate).length;
  const yearOf = (s: string) => Number((s.match(/(20\d\d)/) ?? [])[1] ?? 0);

  let bs = bsImports[0];
  let lines = linesByImport.get(bs.id) ?? [];
  let bestScore = faCostCount(lines);
  for (const b of bsImports) {
    const ls = linesByImport.get(b.id) ?? [];
    const score = faCostCount(ls);
    if (score > bestScore || (score === bestScore && yearOf(b.periodLabel) > yearOf(bs.periodLabel))) {
      bs = b;
      lines = ls;
      bestScore = score;
    }
  }

  const diag: DetectDiag = {
    sectionsPresent: [...new Set(lines.flatMap((l) => l.sectionPath))].slice(0, 40),
    accountCount: lines.filter((l) => l.lineType === "ACCOUNT").length,
    faLineCount: lines.filter((l) => l.sectionPath.some((s) => /fixed asset/i.test(s))).length,
    availableBs: bsImports.map((b) => b.periodLabel),
  };

  const costLines = lines.filter(isCostCandidate);
  // Acumulada por ativo (quando existe a linha individual).
  const accLines = lines.filter(
    (l) => l.lineType === "ACCOUNT" && /accumulated deprecia/i.test(l.label) && l.value != null,
  );

  // Datas de aquisição: 1ª transação por conta no GL.
  const glMin = await prisma.ledgerTxn.groupBy({
    by: ["account"],
    where: { companyId },
    _min: { date: true },
  });
  const minByAcct = new Map(glMin.map((r) => [norm(r.account), r._min.date]));
  const hasGl = glMin.length > 0;

  const existing = await prisma.fixedAsset.findMany({ where: { companyId }, select: { name: true } });
  const existingSet = new Set(existing.map((e) => norm(e.name)));

  const lastYear = new Date().getUTCFullYear() - 1;

  const assets: DetectedAsset[] = costLines
    .map((l) => {
      const name = l.label.trim();
      const cost = Number(l.value);
      const n = norm(name);
      const acc = accLines.find((a) => {
        const an = norm(a.label).replace(/accumulated depreciation -? ?/, "");
        return an.length > 2 && (n.includes(an) || an.includes(n));
      });
      const accumulated = acc ? Math.abs(Number(acc.value)) : null;

      let acquisitionDate: string;
      let acqSource: DetectedAsset["acqSource"];
      const gl = minByAcct.get(n);
      const yn = yearFromName(name);
      if (gl) {
        acquisitionDate = gl.toISOString().slice(0, 10);
        acqSource = "gl";
      } else if (yn) {
        acquisitionDate = `${yn}-07-01`;
        acqSource = "name";
      } else {
        acquisitionDate = `${lastYear}-01-01`;
        acqSource = "default";
      }

      const { category, recoveryYears } = guessCategory(name, l.lineType === "SECTION");
      return { name, cost, accumulated, acquisitionDate, acqSource, category, recoveryYears, alreadyRegistered: existingSet.has(n) };
    })
    .sort((a, b) => b.cost - a.cost);

  return { assets, bsLabel: bs.periodLabel, hasGl, diag };
}
