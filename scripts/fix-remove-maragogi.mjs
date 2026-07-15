// Data-fix (14/07): remove o modelo "Maragogi" do seed — o Stefan o substituiu por
// "Maragogi - T1" e "Maragogi - T2" e o deletou várias vezes, mas o seed ressuscitava
// a cada deploy (upsert por nome; corrigido p/ bootstrap-only no seed-catalog).
// Guardas: só deleta se T1 e T2 existem (a substituição aconteceu) e se NENHUMA simulação
// referencia o modelo na cesta (deletar quebraria o re-run dela). Idempotente.
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const maragogi = await prisma.catalogModel.findUnique({ where: { name: "Maragogi" } });
  if (!maragogi) {
    console.log("fix-remove-maragogi: já não existe — ok");
    return;
  }
  const [t1, t2] = await Promise.all([
    prisma.catalogModel.findUnique({ where: { name: "Maragogi - T1" } }),
    prisma.catalogModel.findUnique({ where: { name: "Maragogi - T2" } }),
  ]);
  if (!t1 || !t2) {
    console.log("fix-remove-maragogi: T1/T2 não encontrados — mantendo por segurança");
    return;
  }
  const sims = await prisma.poolSimulation.findMany({ select: { name: true, units: true } });
  const referenced = sims.filter((s) =>
    (s.units ?? []).some((u) => u.modelId === maragogi.id),
  );
  if (referenced.length > 0) {
    console.log(
      `fix-remove-maragogi: NÃO removido — cesta de ${referenced.map((s) => s.name).join(", ")} referencia o modelo; troque para T1/T2 antes`,
    );
    return;
  }
  await prisma.catalogModel.delete({ where: { id: maragogi.id } }); // combos caem em cascade
  console.log("fix-remove-maragogi: modelo 'Maragogi' removido (T1/T2 ativos, sem referências)");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
