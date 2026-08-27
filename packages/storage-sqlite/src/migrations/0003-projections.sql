CREATE TABLE projection_checkpoints (
  tenant_id TEXT NOT NULL,
  projection_name TEXT NOT NULL,
  partition_key TEXT NOT NULL,
  reducer_version TEXT NOT NULL,
  last_seq INTEGER NOT NULL,
  state_hash TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, projection_name, partition_key)
);

CREATE TABLE transactional_outbox (
  outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  partition_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  available_at TEXT NOT NULL,
  claimed_by TEXT,
  claimed_until TEXT,
  delivered_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  UNIQUE (tenant_id, topic, event_id)
);

CREATE TABLE migration_ledger (
  migration_id TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  bundle_version TEXT NOT NULL,
  dsh_commit TEXT NOT NULL,
  rollback_class TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE evaluation_dataset_manifests (
  tenant_id TEXT NOT NULL,
  evaluation_request_id TEXT NOT NULL,
  dataset_hash TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  frozen_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, evaluation_request_id),
  UNIQUE (tenant_id, dataset_hash)
);

CREATE TABLE compaction_assessments (
  tenant_id TEXT NOT NULL,
  compaction_id TEXT NOT NULL,
  assessment_kind TEXT NOT NULL,
  assessment_artifact_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, compaction_id, assessment_kind)
);
