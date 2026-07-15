// Carga inicial da ficha dos modelos (15/07) — fotos + specs + tagline + descrição
// extraídos do site público da 4U (4youhomes.com/portfolio) para scripts/data/
// model-cards.json (aprovado pelo Stefan: "posso usar o site como carga inicial? sim").
//
// CREATE-ONLY POR CAMPO: só preenche o que está NULL — foto que o Stefan subiu ou campo
// que ele editou pela tela NUNCA é sobrescrito. Re-rodável: atualize o JSON (novos
// modelos do site) e o próximo deploy preenche só o que faltar. Idempotente.
// Aliases mapeiam nome do site → nome(s) no catálogo (ex.: "Maragogi" → T1 e T2;
// "Copacabana G2" → "Copacabana" — variante base; G3 só se existir modelo com esse nome).
import fs from "node:fs";
import path from "node:path";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const cards = JSON.parse(
    fs.readFileSync(path.join(import.meta.dirname, "data", "model-cards.json"), "utf8"),
  );
  let touched = 0;
  for (const card of cards) {
    for (const alias of card.aliases) {
      const m = await prisma.catalogModel.findUnique({ where: { name: alias } });
      if (!m) continue;
      const data = {};
      if (!m.photo && card.photo) {
        data.photo = card.photo;
        data.photoWidth = card.photoWidth;
        data.photoHeight = card.photoHeight;
      }
      if (m.beds == null && card.beds != null) data.beds = card.beds;
      if (m.baths == null && card.baths != null) data.baths = card.baths;
      if (m.garageSpaces == null && card.garageSpaces != null) data.garageSpaces = card.garageSpaces;
      if (m.builtSqft == null && card.builtSqft != null) data.builtSqft = card.builtSqft;
      if (m.sqft == null && card.livingSqft != null) data.sqft = card.livingSqft;
      if (m.tagline == null && card.tagline) data.tagline = card.tagline;
      if (m.description == null && card.description) data.description = card.description;
      if (Object.keys(data).length === 0) {
        console.log(`fix-model-specs: ${alias} — completo, nada a preencher`);
        continue;
      }
      await prisma.catalogModel.update({ where: { id: m.id }, data });
      await prisma.catalogChangeLog.create({
        data: {
          entity: "MODEL",
          entityId: m.id,
          entityName: m.name,
          action: "UPDATE",
          changedBy: "fix-model-specs (site 4youhomes.com)",
          changes: Object.keys(data)
            .filter((k) => !k.startsWith("photoW") && !k.startsWith("photoH"))
            .map((k) => ({
              field: k,
              from: null,
              to: k === "photo" ? `(photo ${card.photoWidth}×${card.photoHeight})` : String(data[k]),
            })),
        },
      });
      touched++;
      console.log(`fix-model-specs: ${alias} ← ${card.name} (${Object.keys(data).join(", ")})`);
    }
  }
  console.log(`fix-model-specs: ${touched} modelo(s) preenchido(s)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
