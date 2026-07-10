#!/usr/bin/env bash
# Sincroniza a base LOCAL (vixus_prodcopy, usada pelo app dev via .env.local) com a
# PRODUÇÃO (Supabase, PROD_DB_URL em .env.prod). A produção SEMPRE prevalece.
# Rodar da raiz do repo após cada deploy: bash scripts/sync-prod-db.sh
# Recria o usuário de preview local no final (não existe em prod).
set -euo pipefail
cd "$(dirname "$0")/.."

PG="/c/Program Files/PostgreSQL/17/bin"
PROD_URL=$(grep -h '^PROD_DB_URL' .env.prod | cut -d'=' -f2- | tr -d '"')
LOCAL_URL=$(grep -h '^DATABASE_URL' .env.local | cut -d'"' -f2)

echo "1/4 dump da produção…"
DUMP=$(mktemp --suffix=.dump)
"$PG/pg_dump.exe" "$PROD_URL" --format=custom --no-owner --no-privileges --file="$DUMP"

echo "2/4 limpando o schema local (vixus_prodcopy)…"
"$PG/psql.exe" "$LOCAL_URL" -q -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"

echo "3/4 restaurando…"
"$PG/pg_restore.exe" --dbname="$LOCAL_URL" --no-owner --no-privileges --exit-on-error "$DUMP"
rm -f "$DUMP"

echo "4/4 recriando o usuário de preview local…"
LOCAL_URL="$LOCAL_URL" node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient({ datasourceUrl: process.env.LOCAL_URL });
(async () => {
  const hash = await bcrypt.hash('dev-preview-123', 10);
  await p.user.upsert({
    where: { email: 'preview@vixus.local' },
    create: { email: 'preview@vixus.local', name: 'Preview Dev', role: 'ADMIN', passwordHash: hash },
    update: { passwordHash: hash },
  });
  console.log('preview@vixus.local ok');
  await p.\$disconnect();
})();
" 2>&1 | tail -1

echo "sync concluído — local espelha a produção."
