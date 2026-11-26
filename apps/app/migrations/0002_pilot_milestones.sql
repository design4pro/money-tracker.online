ALTER TABLE user ADD COLUMN first_paid_at INTEGER;
ALTER TABLE user ADD COLUMN first_transaction_at INTEGER;

CREATE TRIGGER record_first_paid
AFTER UPDATE OF status, expires_at ON entitlement
WHEN NEW.status = 'active' AND NEW.expires_at > NEW.checked_at
BEGIN
  UPDATE user SET first_paid_at = NEW.checked_at
  WHERE id = NEW.user_id AND first_paid_at IS NULL;
END;

CREATE TRIGGER record_first_transaction
AFTER INSERT ON ledger_transaction
BEGIN
  UPDATE user SET first_transaction_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
  WHERE id = NEW.user_id AND first_transaction_at IS NULL;
END;
