import { PrismaClient, UserRole } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Seed inicial.
 * Fase 0: cria um usuário admin de teste (sem senha ainda — login real na Fase 1).
 * Fase 1: passará a semear as empresas/donos reais (Vixus, L2, J. Monteiro...).
 */
async function main() {
  const admin = await prisma.user.upsert({
    where: { email: "admin@vixusglobal.com" },
    update: {},
    create: {
      email: "admin@vixusglobal.com",
      name: "Admin Vixus",
      role: UserRole.ADMIN,
    },
  });
  console.log(`Seed ok — usuário admin: ${admin.email} (${admin.role})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
