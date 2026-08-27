CREATE TABLE mission_command_receipts (
  tenant_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  payload_sha256 TEXT NOT NULL,
  command_id TEXT NOT NULL,
  previous_revision INTEGER NOT NULL CHECK (previous_revision >= 0),
  revision INTEGER NOT NULL CHECK (revision >= previous_revision),
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, mission_id, idempotency_key),
  UNIQUE (tenant_id, command_id),
  FOREIGN KEY (tenant_id, mission_id) REFERENCES mission_streams(tenant_id, mission_id)
);

CREATE TABLE mission_runtime_missions (
  tenant_id TEXT NOT NULL,
  root_session_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, root_session_id),
  UNIQUE (tenant_id, mission_id)
);

CREATE TABLE mission_runtime_tasks (
  tenant_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  task_version INTEGER NOT NULL CHECK (task_version > 0),
  state TEXT NOT NULL,
  state_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, task_id),
  FOREIGN KEY (tenant_id, mission_id) REFERENCES mission_streams(tenant_id, mission_id)
);

CREATE INDEX mission_command_receipts_command
  ON mission_command_receipts(tenant_id, command_id);

CREATE INDEX mission_runtime_tasks_mission
  ON mission_runtime_tasks(tenant_id, mission_id, task_id);
