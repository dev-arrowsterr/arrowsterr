#!/usr/bin/env bash
# Leak tests: builds a throwaway database from schema.sql and every numbered file in supabase/, then checks
# that no one sees data they shouldn't. Needs a local Postgres you can reach as a superuser.
#   DATABASE_URL=postgres://postgres@localhost/postgres npm run test:db
set -euo pipefail
cd "$(dirname "$0")/.."
ADMIN="${DATABASE_URL:-postgres://postgres@localhost/postgres}"
DB="arrowsterr_test_$$"
psql "$ADMIN" -qX -v ON_ERROR_STOP=1 -c "create database $DB" >/dev/null
trap 'psql "$ADMIN" -qX -c "drop database if exists $DB" >/dev/null' EXIT
URL="${ADMIN%/*}/$DB"
psql "$URL" -qX -v ON_ERROR_STOP=1 -f tests/db/supabase_stub.sql
for f in supabase/schema.sql supabase/[0-9]*.sql; do psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$f" >/dev/null 2>&1 || { echo "FAILED: $f"; psql "$URL" -qX -v ON_ERROR_STOP=1 -f "$f"; exit 1; }; done
psql "$URL" -qX -v ON_ERROR_STOP=1 -f tests/db/leaks.sql
