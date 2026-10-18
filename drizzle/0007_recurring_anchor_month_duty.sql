-- Additive: yearly month and JDG duty code on `recurring_series`.
--
-- Numbered `0007` because parallel PR #752 owns `0006` for loans. Do not rebuild this
-- table: a DROP would wipe child recurring rows on D1. No table-level CHECK on these
-- columns for the same reason; writes parse them in `repos/recurring.ts`.
ALTER TABLE `recurring_series` ADD `anchor_month` integer;--> statement-breakpoint
ALTER TABLE `recurring_series` ADD `duty_code` text;
