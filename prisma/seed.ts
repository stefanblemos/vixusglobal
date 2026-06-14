import { PrismaClient, UserRole } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

/**
 * Seed inicial.
 * - Cria/atualiza o usuário admin com senha (hash bcrypt) para login.
 * - As empresas/donos reais serão semeadas após confirmação das entidades.
 */
async function main() {
  const email = "admin@vixusglobal.com";
  const devPassword = process.env.SEED_ADMIN_PASSWORD ?? "vixus@2026";
  const passwordHash = await bcrypt.hash(devPassword, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash, role: UserRole.ADMIN },
    create: {
      email,
      name: "Admin Vixus",
      role: UserRole.ADMIN,
      passwordHash,
    },
  });

  console.log(`Seed ok — admin: ${admin.email} / senha: ${devPassword} (troque depois)`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
