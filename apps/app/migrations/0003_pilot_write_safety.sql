ALTER TABLE entitlement ADD COLUMN refresh_failed_since INTEGER;

CREATE TABLE ledger_mutation (
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  request_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  outcome INTEGER CHECK(outcome IN (0, 1)),
  PRIMARY KEY(user_id, request_id)
) STRICT;

DROP TRIGGER record_first_transaction;

CREATE TRIGGER record_first_transaction
AFTER INSERT ON ledger_transaction
BEGIN
  UPDATE user SET first_transaction_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
  WHERE id = NEW.user_id AND first_paid_at IS NOT NULL
    AND (first_transaction_at IS NULL OR first_transaction_at < first_paid_at);
END;
