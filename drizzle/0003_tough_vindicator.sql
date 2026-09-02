-- Widens `budgets_period_check` to admit 'weekly'. SQLite cannot alter a CHECK, so the table is
-- rebuilt, and a rebuild of `budgets` is not safe on its own: `budget_categories`,
-- `budget_periods` and `budget_transactions` all reference it `ON DELETE CASCADE`, and SQLite's
-- `DROP TABLE` performs an implicit `DELETE FROM` that fires those cascades.
--
-- drizzle-kit's generated body guards that with `PRAGMA foreign_keys=OFF`, which is the documented
-- 12-step procedure and is correct against a plain sqlite3 shell. It is **not** correct here:
-- `wrangler d1 migrations apply` runs the batch inside a transaction, and SQLite makes
-- `PRAGMA foreign_keys` a no-op inside one. Applied unmodified against the local D1 this emptied
-- all three child tables - 27 budget periods and every budget-category link, gone silently, with
-- the migration reporting success.
--
-- So the children are copied out before the rebuild and copied back after it. The staging tables
-- are created with `AS SELECT`, which gives them no constraints and therefore nothing to trip over
-- while the parent does not exist. This is correct whether foreign-key enforcement turns out to be
-- on or off, which matters because local D1 and remote D1 have not always agreed about that.
--
-- Hand-written on purpose, against the "drizzle/ is generated, never hand-edit" rule in CLAUDE.md.
-- The generator cannot see the cascade, and shipping what it produced would have destroyed data.
-- `drizzle/meta` still describes the schema this file arrives at, so `pnpm db:generate` stays
-- silent and the drift gate still holds.
CREATE TABLE `__save_budget_categories` AS SELECT * FROM `budget_categories`;--> statement-breakpoint
CREATE TABLE `__save_budget_periods` AS SELECT * FROM `budget_periods`;--> statement-breakpoint
CREATE TABLE `__save_budget_transactions` AS SELECT * FROM `budget_transactions`;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_budgets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text(200) NOT NULL,
	`kind` text DEFAULT 'category' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`period` text DEFAULT 'monthly' NOT NULL,
	`start_date` text(10) NOT NULL,
	`end_date` text(10),
	`limit_minor` integer NOT NULL,
	`currency_code` text(3) NOT NULL,
	`auto_include` integer DEFAULT true NOT NULL,
	`rollover_policy` text DEFAULT 'none' NOT NULL,
	`alert_thresholds` text DEFAULT '[50,80,100]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budgets_kind_check" CHECK("__new_budgets"."kind" in ('manual', 'category')),
	CONSTRAINT "budgets_status_check" CHECK("__new_budgets"."status" in ('active', 'closed', 'archived')),
	CONSTRAINT "budgets_period_check" CHECK("__new_budgets"."period" in ('one_off', 'weekly', 'monthly', 'quarterly', 'yearly')),
	CONSTRAINT "budgets_rollover_policy_check" CHECK("__new_budgets"."rollover_policy" in ('none', 'carry_surplus', 'carry_all')),
	CONSTRAINT "budgets_limit_minor_check" CHECK("__new_budgets"."limit_minor" > 0),
	CONSTRAINT "budgets_end_date_check" CHECK("__new_budgets"."end_date" is null or "__new_budgets"."end_date" >= "__new_budgets"."start_date"),
	CONSTRAINT "budgets_start_date_check" CHECK(length("__new_budgets"."start_date") = 10),
	CONSTRAINT "budgets_end_date_length_check" CHECK(length("__new_budgets"."end_date") = 10)
);
--> statement-breakpoint
INSERT INTO `__new_budgets`("id", "organization_id", "name", "kind", "status", "period", "start_date", "end_date", "limit_minor", "currency_code", "auto_include", "rollover_policy", "alert_thresholds", "created_at", "updated_at") SELECT "id", "organization_id", "name", "kind", "status", "period", "start_date", "end_date", "limit_minor", "currency_code", "auto_include", "rollover_policy", "alert_thresholds", "created_at", "updated_at" FROM `budgets`;--> statement-breakpoint
DROP TABLE `budgets`;--> statement-breakpoint
ALTER TABLE `__new_budgets` RENAME TO `budgets`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `budgets_organization_id_status_idx` ON `budgets` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `budgets_organization_id_start_date_idx` ON `budgets` (`organization_id`,`start_date`);--> statement-breakpoint
INSERT INTO `budget_categories` (`organization_id`, `budget_id`, `category_id`) SELECT `organization_id`, `budget_id`, `category_id` FROM `__save_budget_categories`;--> statement-breakpoint
INSERT INTO `budget_periods` (`organization_id`, `budget_id`, `period_start`, `period_end`, `limit_minor`, `carried_in_minor`, `spent_minor`, `currency_code`, `closed_at`, `created_at`, `updated_at`) SELECT `organization_id`, `budget_id`, `period_start`, `period_end`, `limit_minor`, `carried_in_minor`, `spent_minor`, `currency_code`, `closed_at`, `created_at`, `updated_at` FROM `__save_budget_periods`;--> statement-breakpoint
INSERT INTO `budget_transactions` (`organization_id`, `budget_id`, `transaction_id`, `added_by_user_id`, `created_at`) SELECT `organization_id`, `budget_id`, `transaction_id`, `added_by_user_id`, `created_at` FROM `__save_budget_transactions`;--> statement-breakpoint
DROP TABLE `__save_budget_categories`;--> statement-breakpoint
DROP TABLE `__save_budget_periods`;--> statement-breakpoint
DROP TABLE `__save_budget_transactions`;
