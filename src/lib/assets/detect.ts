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

function guessCategory(name: string): { category: string; recoveryYears: number } {
  const n = name.toLowerCase();
  if (/comput|laptop|server|monitor|printer|camera|alarm|software|electronic/.test(n)) return { category: "COMPUTER", recoveryYears: 5 };
  if (/trailer|dumproller|vehicle|truck|\bcar\b|\bvan\b|forklift/.test(n)) return { category: "AUTO", recoveryYears: 5 };
  if (/furnitur|fixture|desk|chair|cabinet|shelv/.test(n)) return { category: "FURNITURE", recoveryYears: 7 };
  if (/building|real estate|land improv|fence|paving/.test(n)) return { category: "LAND_IMP", recoveryYears: 15 };
  return { category: "EQUIPMENT", recoveryYears: 7 };
}

const yearFromName = (name: string): number | null => {
  const m = name.match(/(20\d\d)/);
  return m ? Number(m[1]) : null;
};

export async function detectAssetsFromQbo(
  companyId: string,
): Promise<{ assets: DetectedAsset[]; bsLabel: string | null; hasGl: boolean }> {
  const bs = await prisma.qboImport.findFirst({
    where: { companyId, reportKind: "BALANCE_SHEET" },
    orderBy: { createdAt: "desc" },
    select: { id: true, periodLabel: true },
  });
  if (!bs) return { assets: [], bsLabel: null, hasGl: false };

  const lines = await prisma.qboImportLine.findMany({
    where: { importId: bs.id },
    select: { label: true, value: true, lineType: true, sectionPath: true },
  });

  // Contas de ativo (custo): ACCOUNT sob "Fixed Asset", valor positivo, não-depreciação.
  const costLines = lines.filter(
    (l) =>
      l.lineType === "ACCOUNT" &&
      l.sectionPath.some((s) => /fixed asset/i.test(s)) &&
      l.value != null &&
      Number(l.value) > 0 &&
      !/depreciat/i.test(l.label),
  );
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

      const { category, recoveryYears } = guessCategory(name);
      return { name, cost, accumulated, acquisitionDate, acqSource, category, recoveryYears, alreadyRegistered: existingSet.has(n) };
    })
    .sort((a, b) => b.cost - a.cost);

  return { assets, bsLabel: bs.periodLabel, hasGl };
}
