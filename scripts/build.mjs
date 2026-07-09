// Build do Vercel. Aplica as migrations no banco APENAS em deploy de PRODUÇÃO
// (VERCEL_ENV=production) — assim previews/branches nunca alteram o schema do
// banco real. Depois gera o Prisma Client e builda o Next.
import { execSync } from "node:child_process";

const run = (cmd) => execSync(cmd, { stdio: "inherit" });

if (process.env.VERCEL_ENV === "production") {
  console.log("▲ Production deploy — applying database migrations (prisma migrate deploy)");
  run("npx prisma migrate deploy");
} else {
  console.log(
    `▲ ${process.env.VERCEL_ENV ?? "local"} build — skipping migrations (no schema changes to the DB)`,
  );
}

run("npx prisma generate");

if (process.env.VERCEL_ENV === "production") {
  // Catálogo do simulador de pools (cenários OPT/REAL/CONS, locais, modelos, banco) —
  // upserts idempotentes; precisa do client gerado e das migrations aplicadas.
  console.log("▲ Seeding pool simulator catalog (idempotent)");
  run("node scripts/seed-catalog.mjs");
  // Pool real VHP-I (PH3): investidores, aportes, casas e statement do loan 77959 —
  // create-only (nunca sobrescreve o que já foi lançado/ajustado pela tela).
  console.log("▲ Seeding VHP-I / PH3 pool (idempotent)");
  run("node scripts/seed-ph3.mjs");
  // Data-fixes condicionados (no-op depois de aplicados / se o usuário editou)
  run("node scripts/fix-ph3-sales-panel.mjs");
  run("node scripts/fix-rbi-loi.mjs");
}

run("next build");
