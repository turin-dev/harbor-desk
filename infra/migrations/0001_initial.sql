CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  oidc_issuer text NOT NULL,
  oidc_subject text NOT NULL,
  display_name text NOT NULL,
  email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (oidc_issuer, oidc_subject)
);

CREATE TABLE IF NOT EXISTS organization_members (
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('viewer', 'operator', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS hosts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  endpoint text NOT NULL,
  status text NOT NULL DEFAULT 'unknown',
  engine_version text,
  api_version text,
  min_api_version text,
  capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS host_secrets (
  host_id uuid PRIMARY KEY REFERENCES hosts(id) ON DELETE CASCADE,
  secret_reference text NOT NULL,
  encrypted_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  rotated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS host_grants (
  host_id uuid NOT NULL REFERENCES hosts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('viewer', 'operator', 'admin')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (host_id, user_id)
);

CREATE TABLE IF NOT EXISTS operations (
  id uuid PRIMARY KEY,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  host_id uuid REFERENCES hosts(id) ON DELETE SET NULL,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
  progress integer CHECK (progress IS NULL OR (progress >= 0 AND progress <= 100)),
  message text,
  error jsonb,
  idempotency_key text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  host_id uuid REFERENCES hosts(id) ON DELETE SET NULL,
  action text NOT NULL,
  resource_kind text,
  resource_id text,
  result text NOT NULL CHECK (result IN ('success', 'failure', 'denied')),
  request_id text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  severity text NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
