CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  client_name TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS milestones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  amount_due NUMERIC(12, 2) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('not_started', 'in_progress', 'completed', 'paid')),
  due_date DATE NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  milestone_id UUID NOT NULL REFERENCES milestones(id) ON DELETE CASCADE,
  amount_paid NUMERIC(12, 2) NOT NULL,
  paid_at DATE,
  method TEXT
);

CREATE TABLE IF NOT EXISTS progress_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
  milestone_id UUID REFERENCES milestones(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  note TEXT NOT NULL,
  has_inspection_photos BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('contract', 'policy')),
  title TEXT NOT NULL,
  source_path TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  chunk_index INT NOT NULL,
  content TEXT NOT NULL,
  embedding VECTOR(1024),
  page_number INT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'project_manager', 'contractor'))
);

-- zone_id is nullable ('full' access grants aren't scoped to one zone), so it
-- can't be part of a composite primary key — Postgres requires PK columns
-- to be NOT NULL. Use a surrogate key instead.
CREATE TABLE IF NOT EXISTS project_access (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  permission TEXT NOT NULL CHECK (permission IN ('full', 'zone_restricted')),
  zone_id UUID REFERENCES zones(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS query_traces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  question TEXT NOT NULL,
  user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trace_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id UUID NOT NULL REFERENCES query_traces(id) ON DELETE CASCADE,
  step_index INT NOT NULL,
  agent TEXT NOT NULL,
  tool TEXT,
  input JSONB,
  output JSONB,
  latency_ms INT
);

CREATE INDEX IF NOT EXISTS idx_zones_project ON zones(project_id);
CREATE INDEX IF NOT EXISTS idx_milestones_zone ON milestones(zone_id);
CREATE INDEX IF NOT EXISTS idx_payments_milestone ON payments(milestone_id);
CREATE INDEX IF NOT EXISTS idx_progress_logs_zone ON progress_logs(zone_id);
CREATE INDEX IF NOT EXISTS idx_progress_logs_milestone ON progress_logs(milestone_id);
CREATE INDEX IF NOT EXISTS idx_documents_project ON documents(project_id);
CREATE INDEX IF NOT EXISTS idx_doc_chunks_document ON doc_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_project_access_user ON project_access(user_id);

-- Approximate nearest-neighbor index for contract chunk retrieval.
CREATE INDEX IF NOT EXISTS idx_doc_chunks_embedding ON doc_chunks
  USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
