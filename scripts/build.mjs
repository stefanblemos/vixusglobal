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
  console.log("▲ Seeding pool simulator catalog (bootstrap-only)");
  run("node scripts/seed-catalog.mjs");
  // Remove o Maragogi do seed (substituído por T1/T2; ressuscitava a cada deploy)
  run("node scripts/fix-remove-maragogi.mjs");
  // Ficha dos modelos (foto/specs/descrição do site 4U) — create-only por campo
  run("node scripts/fix-model-specs.mjs");
  // Funde a duplicada Vixus International → Vixus America ANTES do seed da PH3
  // (o seed antigo criou uma casca por não olhar aliases; no-op depois de aplicado)
  run("node scripts/fix-vai-dupe.mjs");
  // Renames 16/07: fase Vixus → "Phase - X" (PH-3/PH-4); VHP-* reservado p/ PH7+.
  // Roda ANTES do seed-ph3 (que agora usa a chave PH-3) p/ não criar casca.
  run("node scripts/fix-phase-renames.mjs");
  // Pool real PH-3 (Phase - 3): investidores, aportes, casas e statement do loan 77959 —
  // create-only (nunca sobrescreve o que já foi lançado/ajustado pela tela).
  console.log("▲ Seeding Phase-3 pool (idempotent)");
  run("node scripts/seed-ph3.mjs");
  // Data-fixes condicionados (no-op depois de aplicados / se o usuário editou)
  run("node scripts/fix-ph3-sales-panel.mjs");
  run("node scripts/fix-rbi-loi.mjs");
  run("node scripts/fix-scenarios-restore.mjs");
}

run("next build");
