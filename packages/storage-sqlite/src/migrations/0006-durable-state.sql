CREATE TABLE durable_state_records (
  tenant_id TEXT NOT NULL,
  namespace TEXT NOT NULL,
  record_key TEXT NOT NULL,
  storage_revision INTEGER NOT NULL CHECK (storage_revision > 0),
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, namespace, record_key)
);

CREATE INDEX durable_state_namespace
  ON durable_state_records(tenant_id, namespace, updated_at, record_key);
