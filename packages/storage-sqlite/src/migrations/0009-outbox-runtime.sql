ALTER TABLE transactional_outbox ADD COLUMN dead_lettered_at TEXT;
ALTER TABLE transactional_outbox ADD COLUMN last_error TEXT;

CREATE TABLE outbox_delivery_receipts (
  tenant_id TEXT NOT NULL,
  outbox_id INTEGER NOT NULL,
  topic TEXT NOT NULL,
  partition_key TEXT NOT NULL,
  event_id TEXT NOT NULL,
  attempts INTEGER NOT NULL,
  delivered_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, outbox_id),
  UNIQUE (tenant_id, topic, event_id),
  FOREIGN KEY (outbox_id) REFERENCES transactional_outbox(outbox_id)
);

CREATE TABLE outbox_consumer_offsets (
  tenant_id TEXT NOT NULL,
  topic TEXT NOT NULL,
  partition_key TEXT NOT NULL,
  last_outbox_id INTEGER NOT NULL,
  last_event_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (tenant_id, topic, partition_key)
);

CREATE INDEX ix_outbox_dispatch_ready
  ON transactional_outbox(
    tenant_id, delivered_at, dead_lettered_at, available_at, claimed_until,
    outbox_id
  );
