PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE mission_streams (
  tenant_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  aggregate_revision INTEGER NOT NULL DEFAULT 0 CHECK (aggregate_revision >= 0),
  last_seq INTEGER NOT NULL DEFAULT 0 CHECK (last_seq >= 0),
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, mission_id)
);

CREATE TABLE mission_events (
  tenant_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision > 0),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  actor_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  causation_id TEXT,
  correlation_id TEXT,
  idempotency_key TEXT,
  occurred_at TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, mission_id, seq),
  UNIQUE (tenant_id, event_id),
  FOREIGN KEY (tenant_id, mission_id) REFERENCES mission_streams(tenant_id, mission_id)
);

CREATE TABLE administrative_streams (
  tenant_id TEXT PRIMARY KEY,
  aggregate_revision INTEGER NOT NULL DEFAULT 0,
  last_seq INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE administrative_events (
  tenant_id TEXT NOT NULL,
  seq INTEGER NOT NULL CHECK (seq > 0),
  aggregate_revision INTEGER NOT NULL CHECK (aggregate_revision > 0),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT,
  occurred_at TEXT NOT NULL,
  event_hash TEXT NOT NULL,
  PRIMARY KEY (tenant_id, seq),
  UNIQUE (tenant_id, event_id)
);

CREATE TABLE artifacts (
  tenant_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  media_type TEXT NOT NULL,
  byte_length INTEGER NOT NULL CHECK (byte_length >= 0),
  classification TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deleted_at TEXT,
  PRIMARY KEY (tenant_id, artifact_id),
  UNIQUE (tenant_id, sha256, storage_key)
);

CREATE TABLE artifact_refs (
  tenant_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  ref_kind TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, artifact_id, ref_kind, ref_id),
  FOREIGN KEY (tenant_id, artifact_id) REFERENCES artifacts(tenant_id, artifact_id)
);

CREATE TABLE radio_requests (
  tenant_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_version INTEGER NOT NULL,
  state TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  lease_owner TEXT,
  lease_version INTEGER NOT NULL DEFAULT 0,
  visibility_until TEXT,
  expires_at TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, request_id),
  UNIQUE (tenant_id, idempotency_key)
);

CREATE TABLE radio_guidance (
  tenant_id TEXT NOT NULL,
  guidance_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  expected_task_version INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TEXT NOT NULL,
  delivered_at TEXT,
  PRIMARY KEY (tenant_id, guidance_id),
  FOREIGN KEY (tenant_id, request_id) REFERENCES radio_requests(tenant_id, request_id)
);

CREATE TABLE workspace_snapshots (
  tenant_id TEXT NOT NULL,
  workspace_snapshot_id TEXT NOT NULL,
  workspace_key TEXT NOT NULL,
  root_path_hash TEXT NOT NULL,
  git_head TEXT NOT NULL,
  tree_hash TEXT NOT NULL,
  dirty_state_hash TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_snapshot_id)
);

CREATE TABLE workspace_leases (
  tenant_id TEXT NOT NULL,
  workspace_lease_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_version INTEGER NOT NULL,
  agent_id TEXT NOT NULL,
  workspace_snapshot_id TEXT NOT NULL,
  mode TEXT NOT NULL,
  path_scope_json TEXT NOT NULL,
  state TEXT NOT NULL,
  lease_version INTEGER NOT NULL,
  acquired_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, workspace_lease_id),
  FOREIGN KEY (tenant_id, workspace_snapshot_id) REFERENCES workspace_snapshots(tenant_id, workspace_snapshot_id)
);

CREATE TABLE integration_orders (
  tenant_id TEXT NOT NULL,
  integration_order_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  task_version INTEGER NOT NULL,
  candidate_patch_id TEXT NOT NULL,
  state TEXT NOT NULL,
  expected_head TEXT NOT NULL,
  expected_tree_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  repository_marker TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, integration_order_id)
);

CREATE TABLE integration_receipts (
  tenant_id TEXT NOT NULL,
  integration_receipt_id TEXT NOT NULL,
  integration_order_id TEXT NOT NULL,
  disposition TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, integration_receipt_id),
  UNIQUE (tenant_id, integration_order_id),
  FOREIGN KEY (tenant_id, integration_order_id) REFERENCES integration_orders(tenant_id, integration_order_id)
);

CREATE TABLE decision_records (
  tenant_id TEXT NOT NULL,
  decision_set_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  root_session_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  state TEXT NOT NULL,
  priority TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  presentation_id TEXT,
  expires_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, decision_set_id, version)
);

CREATE TABLE preset_generations (
  generation TEXT PRIMARY KEY,
  public_preset_id TEXT NOT NULL,
  hidden_archive_id TEXT NOT NULL UNIQUE,
  asset_hash TEXT NOT NULL UNIQUE,
  bundle_version TEXT NOT NULL,
  dsh_commit TEXT NOT NULL,
  status TEXT NOT NULL,
  manifest_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  deprecated_at TEXT
);

CREATE TABLE military_session_bindings (
  tenant_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  root_session_id TEXT NOT NULL,
  generation TEXT NOT NULL,
  capability_fingerprint TEXT NOT NULL,
  binding_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, session_id),
  FOREIGN KEY (generation) REFERENCES preset_generations(generation)
);
