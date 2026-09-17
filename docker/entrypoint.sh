#!/bin/sh
set -e

echo "Applying schema..."
npx tsx src/db/migrate.ts

echo "Seeding synthetic data..."
npx tsx src/db/seed.ts

echo "Ingesting + embedding contracts..."
if ! npx tsx src/ingestion/ingest-contracts.ts; then
  echo "WARNING: contract ingestion failed (likely a missing/unreachable embedding" >&2
  echo "provider — OPENAI_API_KEY for EMBEDDING_PROVIDER=openai, or an unreachable" >&2
  echo "OLLAMA_BASE_URL for EMBEDDING_PROVIDER=ollama)." >&2
  echo "The app will still start, but contract vector search will return no results" >&2
  echo "until this succeeds — fix the provider config and re-run 'docker compose up'." >&2
fi

echo "Starting API server..."
exec npx tsx src/api/server.ts
