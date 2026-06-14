// Deriva um registro de ativos fixos a partir das linhas de um Balance Sheet do QBO.
// Cada ativo costuma ter "Original Cost" (custo) + "Accumulated Depreciation" (contra-ativo).

type Line = {
  lineType: string;
  label: string;
  sectionPath: string[];
  value: unknown;
};

export type AssetRow = { name: string; cost: number; accDep: number; net: number };
export type FixedAssetRegister = {
  rows: AssetRow[];
  gross: number;
  accDep: number;
  net: number | null;
};

const subject = (label: string) => {
  const m = label.match(/^total\s+(?:for|para|do|da|de)\s+(.+)$/i);
  return (m?.[1] ?? label.replace(/^total\s+/i, "")).trim().toLowerCase();
};

export function buildFixedAssetRegister(lines: Line[]): FixedAssetRegister | null {
  const fa = lines.filter((l) => l.sectionPath.some((s) => /fixed asset/i.test(s)));
  if (fa.length === 0) return null;

  // Valor líquido vem do total do QBO ("Total for Fixed Assets"), que fica no nível de Assets.
  const netLine = lines.find((l) => l.lineType === "TOTAL" && subject(l.label) === "fixed assets");
  const net = netLine?.value != null ? Number(netLine.value) : null;

  const assets = new Map<string, { name: string; cost: number; accDep: number }>();
  let accDep = 0;
  for (const l of fa) {
    if (l.lineType !== "ACCOUNT" || l.value == null) continue;
    const v = Number(l.value);
    const isDep = /depreciat/i.test(l.label);
    if (isDep) accDep += v;

    const parent = l.sectionPath[l.sectionPath.length - 1] ?? "";
    const flat = /fixed assets$/i.test(parent); // folha direto sob "Fixed Assets"
    const key = flat ? `leaf:${l.label}` : l.sectionPath.join(">");
    const name = flat ? l.label : parent;

    const a = assets.get(key) ?? { name, cost: 0, accDep: 0 };
    if (isDep) a.accDep += v;
    else a.cost += v;
    assets.set(key, a);
  }

  const rows = [...assets.values()]
    .map((a) => ({ ...a, net: a.cost + a.accDep }))
    .filter((a) => a.cost !== 0 || a.accDep !== 0)
    .sort((a, b) => b.cost - a.cost);

  const gross = net != null ? net - accDep : rows.reduce((s, r) => s + r.cost, 0);
  return { rows, gross, accDep, net };
}
