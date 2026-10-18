-- Additive: workspace civil timezone, and `book` on `recurring_series`.
--
-- drizzle-kit's first draft rebuilt `recurring_series` (`DROP TABLE` + copy). That is not safe
-- here: `recurring_periods`, `recurring_links`, `recurring_candidates` and
-- `transactions.recurring_series_id` all reference it `ON DELETE CASCADE`. D1 applies a
-- migration inside a transaction, where `PRAGMA foreign_keys` is a no-op (see the comment at
-- the top of `0003_tough_vindicator.sql`). A DROP would empty the children even if the PRAGMA
-- were present.
--
-- SQLite can ADD a defaulted column without rebuilding, so this file does that. There is no
-- table-level `CHECK` on `book`: adding one would require the rebuild this file exists to
-- avoid. Every write parses `z.enum(BOOKS)` in `repos/recurring.ts` instead.
--
-- Numbered `0007` on purpose: parallel PR #752 already owns `0006` for loans. Both files can
-- land; wrangler applies them by name. Hand-written against the "drizzle/ is generated" rule —
-- `drizzle/meta` still describes the schema this file arrives at, so `pnpm db:generate` stays
-- silent and the drift gate still holds.
CREATE TABLE `organization_settings` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`timezone` text(64) DEFAULT 'Europe/Warsaw' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_settings_timezone_length_check" CHECK(length("organization_settings"."timezone") <= 64)
);
--> statement-breakpoint
ALTER TABLE `recurring_series` ADD `book` text DEFAULT 'personal' NOT NULL;--> statement-breakpoint
CREATE INDEX `recurring_series_organization_id_book_idx` ON `recurring_series` (`organization_id`,`book`);
