CREATE TABLE authority_contexts (
  tenant_id TEXT NOT NULL,
  authority_context_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  context_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, authority_context_id)
);

CREATE TABLE authorization_receipts (
  tenant_id TEXT NOT NULL,
  authorization_id TEXT NOT NULL,
  principal_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  receipt_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, authorization_id)
);

CREATE TABLE policy_documents (
  tenant_id TEXT NOT NULL,
  policy_kind TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  status TEXT NOT NULL,
  document_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, policy_kind, policy_id, revision)
);

CREATE TABLE model_selection_receipts (
  tenant_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  source TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  selected_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, receipt_id)
);

CREATE TABLE budget_reservations (
  tenant_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  scope_kind TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  state TEXT NOT NULL,
  reserved_json TEXT NOT NULL,
  lease_version INTEGER NOT NULL DEFAULT 1,
  lease_until TEXT NOT NULL,
  created_at TEXT NOT NULL,
  settled_at TEXT,
  PRIMARY KEY (tenant_id, reservation_id)
);

CREATE TABLE budget_usage_receipts (
  tenant_id TEXT NOT NULL,
  usage_receipt_id TEXT NOT NULL,
  reservation_id TEXT NOT NULL,
  actual_json TEXT NOT NULL,
  released_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, usage_receipt_id),
  UNIQUE (tenant_id, reservation_id, usage_receipt_id),
  FOREIGN KEY (tenant_id, reservation_id) REFERENCES budget_reservations(tenant_id, reservation_id)
);

CREATE TABLE tactical_source_snapshots (
  tenant_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  source_owner_id TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  classification TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE',
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  PRIMARY KEY (tenant_id, snapshot_id)
);

CREATE TABLE tactical_derivations (
  tenant_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  derived_kind TEXT NOT NULL,
  derived_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, source_snapshot_id, derived_kind, derived_id),
  FOREIGN KEY (tenant_id, source_snapshot_id) REFERENCES tactical_source_snapshots(tenant_id, snapshot_id)
);

CREATE TABLE knowledge_revocation_orders (
  tenant_id TEXT NOT NULL,
  revocation_order_id TEXT NOT NULL,
  source_snapshot_id TEXT NOT NULL,
  state TEXT NOT NULL,
  order_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (tenant_id, revocation_order_id),
  FOREIGN KEY (tenant_id, source_snapshot_id) REFERENCES tactical_source_snapshots(tenant_id, snapshot_id)
);

CREATE TABLE evaluation_jobs (
  tenant_id TEXT NOT NULL,
  evaluation_request_id TEXT NOT NULL,
  state TEXT NOT NULL,
  request_json TEXT NOT NULL,
  lease_owner TEXT,
  lease_version INTEGER NOT NULL DEFAULT 0,
  lease_until TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, evaluation_request_id)
);

CREATE TABLE evaluation_reports (
  tenant_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  evaluation_request_id TEXT NOT NULL,
  report_revision INTEGER NOT NULL CHECK (report_revision > 0),
  dataset_hash TEXT NOT NULL,
  report_artifact_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, report_id, report_revision),
  FOREIGN KEY (tenant_id, evaluation_request_id) REFERENCES evaluation_jobs(tenant_id, evaluation_request_id)
);

CREATE TABLE compaction_attempts (
  tenant_id TEXT NOT NULL,
  attempt_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  pressure_generation INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  attempt_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  PRIMARY KEY (tenant_id, attempt_id),
  UNIQUE (tenant_id, session_id, agent_id, pressure_generation)
);

CREATE TABLE bundle_lifecycle_receipts (
  operation_id TEXT PRIMARY KEY,
  operation TEXT NOT NULL,
  from_version TEXT NOT NULL,
  to_version TEXT NOT NULL,
  status TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL
);

CREATE INDEX ix_authorization_active
  ON authorization_receipts(tenant_id, principal_id, action, resource, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX ix_policy_active
  ON policy_documents(tenant_id, policy_kind, policy_id, status, revision DESC);
CREATE INDEX ix_budget_scope
  ON budget_reservations(tenant_id, scope_kind, scope_id, state, lease_until);
CREATE INDEX ix_tactical_derivation_target
  ON tactical_derivations(tenant_id, derived_kind, derived_id);
CREATE INDEX ix_evaluation_queue
  ON evaluation_jobs(tenant_id, state, lease_until, created_at);

CREATE TABLE preset_resume_receipts (
  tenant_id TEXT NOT NULL,
  receipt_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  requested_generation TEXT NOT NULL,
  resolved_generation TEXT,
  disposition TEXT NOT NULL,
  compatibility_report_id TEXT NOT NULL,
  migration_order_id TEXT,
  receipt_json TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, receipt_id),
  UNIQUE (tenant_id, session_id, requested_generation, completed_at)
);

CREATE TABLE agent_execution_bindings (
  tenant_id TEXT NOT NULL,
  binding_id TEXT NOT NULL,
  root_session_id TEXT NOT NULL,
  mission_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_generation INTEGER NOT NULL CHECK (agent_generation > 0),
  template_id TEXT NOT NULL,
  template_revision INTEGER NOT NULL CHECK (template_revision > 0),
  preset_generation TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  reasoning_effort TEXT NOT NULL,
  binding_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, binding_id),
  UNIQUE (tenant_id, agent_id, agent_generation)
);

CREATE TABLE performance_evaluation_appeals (
  tenant_id TEXT NOT NULL,
  appeal_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  report_revision INTEGER NOT NULL CHECK (report_revision > 0),
  submitted_by TEXT NOT NULL,
  state TEXT NOT NULL,
  appeal_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  resolved_at TEXT,
  superseding_report_id TEXT,
  PRIMARY KEY (tenant_id, appeal_id),
  FOREIGN KEY (tenant_id, report_id, report_revision)
    REFERENCES evaluation_reports(tenant_id, report_id, report_revision)
);

CREATE INDEX ix_preset_resume_session
  ON preset_resume_receipts(tenant_id, session_id, completed_at DESC);
CREATE INDEX ix_agent_execution_mission
  ON agent_execution_bindings(tenant_id, mission_id, template_id, template_revision);
CREATE INDEX ix_evaluation_appeals_report
  ON performance_evaluation_appeals(tenant_id, report_id, report_revision, state, submitted_at);
