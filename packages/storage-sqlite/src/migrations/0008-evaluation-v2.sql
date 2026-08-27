CREATE TABLE evaluation_run_records (
  tenant_id TEXT NOT NULL,
  evaluation_request_id TEXT NOT NULL,
  storage_revision INTEGER NOT NULL CHECK (storage_revision > 0),
  state TEXT NOT NULL,
  record_json TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, evaluation_request_id),
  FOREIGN KEY (tenant_id, evaluation_request_id)
    REFERENCES evaluation_jobs(tenant_id, evaluation_request_id)
);

CREATE TABLE evaluation_report_lineage (
  tenant_id TEXT NOT NULL,
  report_id TEXT NOT NULL,
  report_revision INTEGER NOT NULL CHECK (report_revision > 0),
  evaluation_request_id TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('CURRENT', 'SUPERSEDED', 'WITHDRAWN')),
  supersedes_report_id TEXT,
  superseded_by_report_id TEXT,
  artifact_ref_json TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, report_id, report_revision),
  FOREIGN KEY (tenant_id, report_id, report_revision)
    REFERENCES evaluation_reports(tenant_id, report_id, report_revision)
);

CREATE INDEX ix_evaluation_run_state
  ON evaluation_run_records(tenant_id, state, updated_at);

CREATE INDEX ix_evaluation_report_request
  ON evaluation_report_lineage(
    tenant_id, evaluation_request_id, created_at DESC, report_revision DESC
  );

CREATE UNIQUE INDEX ux_evaluation_current_report
  ON evaluation_report_lineage(tenant_id, evaluation_request_id)
  WHERE state = 'CURRENT';
