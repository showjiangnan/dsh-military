CREATE TABLE mission_command_operations (
  tenant_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  command_fingerprint TEXT NOT NULL,
  command_id TEXT NOT NULL,
  expected_revision INTEGER NOT NULL CHECK (expected_revision >= 0),
  previous_seq INTEGER NOT NULL CHECK (previous_seq >= 0),
  state TEXT NOT NULL CHECK (
    state IN ('PENDING_EFFECT', 'RETRYABLE', 'EFFECT_APPLIED', 'COMMITTED')
  ),
  lease_owner TEXT,
  lease_version INTEGER NOT NULL DEFAULT 1 CHECK (lease_version > 0),
  lease_until TEXT,
  result_json TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, mission_id, idempotency_key),
  UNIQUE (tenant_id, command_id),
  FOREIGN KEY (tenant_id, mission_id)
    REFERENCES mission_streams(tenant_id, mission_id)
);

CREATE INDEX ix_mission_command_operations_recovery
  ON mission_command_operations(
    tenant_id, state, lease_until, updated_at, mission_id
  );
