#!/usr/bin/env bash
# Run Prisma CLI with DATABASE_URL loaded from .env.local (preferred) or .env — same as Next.js.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
# shellcheck source=load-database-url.sh
source "$ROOT/scripts/load-database-url.sh"
if ! load_database_url; then
  echo "Missing DATABASE_URL. Add it to .env.local (see .env.example) or .env, then retry." >&2
  exit 1
fi
exec npx prisma "$@"
