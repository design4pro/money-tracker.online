CREATE TABLE `organization_settings` (
	`organization_id` text PRIMARY KEY NOT NULL,
	`timezone` text(64) DEFAULT 'Europe/Warsaw' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "organization_settings_timezone_length_check" CHECK(length("organization_settings"."timezone") <= 64)
);
--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_recurring_series` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text(200) NOT NULL,
	`kind` text NOT NULL,
	`direction` text NOT NULL,
	`expected_amount_minor` integer NOT NULL,
	`expected_currency_code` text(3) NOT NULL,
	`frequency` text NOT NULL,
	`anchor_day` integer,
	`start_date` text(10) NOT NULL,
	`end_date` text(10),
	`max_occurrences` integer,
	`account_id` text,
	`category_id` text,
	`payee_id` text,
	`auto_record` integer DEFAULT false NOT NULL,
	`matching_rules` text,
	`remind_before` text,
	`notify_email` integer DEFAULT false NOT NULL,
	`show_in_widget` integer DEFAULT true NOT NULL,
	`book` text DEFAULT 'personal' NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`completed_at` integer,
	`logo_domain` text,
	`logo_initials` text(4),
	`logo_color` text(7),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`expected_currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payee_id`) REFERENCES `payees`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recurring_series_kind_check" CHECK("__new_recurring_series"."kind" in ('subscription', 'bill', 'installment', 'income')),
	CONSTRAINT "recurring_series_book_check" CHECK("__new_recurring_series"."book" in ('business', 'personal')),
	CONSTRAINT "recurring_series_direction_check" CHECK("__new_recurring_series"."direction" in ('income', 'expense')),
	CONSTRAINT "recurring_series_frequency_check" CHECK("__new_recurring_series"."frequency" in ('weekly', 'biweekly', 'monthly', 'quarterly', 'semi_annual', 'annual')),
	CONSTRAINT "recurring_series_expected_amount_minor_check" CHECK("__new_recurring_series"."expected_amount_minor" > 0),
	CONSTRAINT "recurring_series_anchor_day_check" CHECK("__new_recurring_series"."anchor_day" is null or ("__new_recurring_series"."anchor_day" >= 1 and "__new_recurring_series"."anchor_day" <= 31)),
	CONSTRAINT "recurring_series_max_occurrences_check" CHECK("__new_recurring_series"."max_occurrences" is null or "__new_recurring_series"."max_occurrences" > 0),
	CONSTRAINT "recurring_series_end_date_check" CHECK("__new_recurring_series"."end_date" is null or "__new_recurring_series"."end_date" >= "__new_recurring_series"."start_date"),
	CONSTRAINT "recurring_series_auto_record_excludes_matching_rules_check" CHECK(not ("__new_recurring_series"."auto_record" = 1 and "__new_recurring_series"."matching_rules" is not null)),
	CONSTRAINT "recurring_series_start_date_check" CHECK(length("__new_recurring_series"."start_date") = 10),
	CONSTRAINT "recurring_series_end_date_length_check" CHECK(length("__new_recurring_series"."end_date") = 10)
);
--> statement-breakpoint
INSERT INTO `__new_recurring_series`("id", "organization_id", "name", "kind", "direction", "expected_amount_minor", "expected_currency_code", "frequency", "anchor_day", "start_date", "end_date", "max_occurrences", "account_id", "category_id", "payee_id", "auto_record", "matching_rules", "remind_before", "notify_email", "show_in_widget", "book", "is_active", "completed_at", "logo_domain", "logo_initials", "logo_color", "created_at", "updated_at") SELECT "id", "organization_id", "name", "kind", "direction", "expected_amount_minor", "expected_currency_code", "frequency", "anchor_day", "start_date", "end_date", "max_occurrences", "account_id", "category_id", "payee_id", "auto_record", "matching_rules", "remind_before", "notify_email", "show_in_widget", 'personal', "is_active", "completed_at", "logo_domain", "logo_initials", "logo_color", "created_at", "updated_at" FROM `recurring_series`;--> statement-breakpoint
DROP TABLE `recurring_series`;--> statement-breakpoint
ALTER TABLE `__new_recurring_series` RENAME TO `recurring_series`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `recurring_series_organization_id_is_active_idx` ON `recurring_series` (`organization_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `recurring_series_organization_id_account_id_idx` ON `recurring_series` (`organization_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `recurring_series_organization_id_payee_id_idx` ON `recurring_series` (`organization_id`,`payee_id`);--> statement-breakpoint
CREATE INDEX `recurring_series_organization_id_book_idx` ON `recurring_series` (`organization_id`,`book`);
--> statement-breakpoint
INSERT INTO `organization_settings` (`organization_id`, `timezone`, `created_at`, `updated_at`)
SELECT `id`, 'Europe/Warsaw', `created_at`, COALESCE(`updated_at`, `created_at`) FROM `organization`;