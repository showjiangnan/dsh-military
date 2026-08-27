CREATE UNIQUE INDEX ux_mission_event_idempotency
  ON mission_events(tenant_id, mission_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_mission_events_type_time ON mission_events(tenant_id, event_type, occurred_at);
CREATE UNIQUE INDEX ux_admin_event_idempotency
  ON administrative_events(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX ix_radio_queue ON radio_requests(tenant_id, state, visibility_until, expires_at);
CREATE INDEX ix_workspace_leases_resource ON workspace_leases(tenant_id, mission_id, task_id, state, expires_at);
CREATE INDEX ix_integration_queue ON integration_orders(tenant_id, state, created_at);
CREATE UNIQUE INDEX ux_decision_active_presentation
  ON decision_records(tenant_id, presentation_id)
  WHERE presentation_id IS NOT NULL;
CREATE INDEX ix_session_generation ON military_session_bindings(tenant_id, generation);
CREATE INDEX ix_artifact_refs_target ON artifact_refs(tenant_id, ref_kind, ref_id);
