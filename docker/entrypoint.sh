#!/bin/sh
set -e

echo "Applying schema..."
npx tsx src/db/migrate.ts

echo "Seeding synthetic data..."
npx tsx src/db/seed.ts

echo "Ingesting + embedding contracts..."
if ! npx tsx src/ingestion/ingest-contracts.ts; then
  echo "WARNING: contract ingestion failed (likely a missing OPENAI_API_KEY)." >&2
  echo "The app will still start, but contract vector search will return no results" >&2
  echo "until this succeeds — set OPENAI_API_KEY and re-run 'docker compose up'." >&2
fi

echo "Starting API server..."
exec npx tsx src/api/server.ts
