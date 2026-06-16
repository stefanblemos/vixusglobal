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
run("next build");
