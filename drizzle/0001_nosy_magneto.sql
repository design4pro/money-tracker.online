CREATE TABLE `account_balances` (
	`organization_id` text NOT NULL,
	`account_id` text NOT NULL,
	`date` text(10) NOT NULL,
	`native_minor` integer NOT NULL,
	`ref_minor` integer NOT NULL,
	`rate_e10` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `account_id`, `date`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "account_balances_rate_e10_check" CHECK("account_balances"."rate_e10" > 0),
	CONSTRAINT "account_balances_date_check" CHECK(length("account_balances"."date") = 10)
);
--> statement-breakpoint
CREATE INDEX `account_balances_organization_id_date_idx` ON `account_balances` (`organization_id`,`date`);--> statement-breakpoint
CREATE TABLE `account_group_members` (
	`organization_id` text NOT NULL,
	`group_id` text NOT NULL,
	`account_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`group_id`, `account_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `account_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "account_group_members_position_check" CHECK("account_group_members"."position" >= 0)
);
--> statement-breakpoint
CREATE INDEX `account_group_members_organization_id_account_id_idx` ON `account_group_members` (`organization_id`,`account_id`);--> statement-breakpoint
CREATE TABLE `account_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text(100) NOT NULL,
	`parent_id` text,
	`position` integer DEFAULT 0 NOT NULL,
	`logo_domain` text,
	`logo_initials` text(4),
	`logo_color` text(7),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `account_groups`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "account_groups_position_check" CHECK("account_groups"."position" >= 0),
	CONSTRAINT "account_groups_logo_color_check" CHECK(length("account_groups"."logo_color") = 7),
	CONSTRAINT "account_groups_parent_self_check" CHECK("account_groups"."parent_id" <> "account_groups"."id")
);
--> statement-breakpoint
CREATE INDEX `account_groups_organization_id_position_idx` ON `account_groups` (`organization_id`,`position`);--> statement-breakpoint
CREATE INDEX `account_groups_organization_id_parent_id_idx` ON `account_groups` (`organization_id`,`parent_id`);--> statement-breakpoint
CREATE TABLE `accounts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text(100) NOT NULL,
	`category` text DEFAULT 'general' NOT NULL,
	`currency_code` text(3) NOT NULL,
	`initial_balance_minor` integer DEFAULT 0 NOT NULL,
	`ref_initial_balance_minor` integer DEFAULT 0 NOT NULL,
	`current_balance_minor` integer DEFAULT 0 NOT NULL,
	`ref_current_balance_minor` integer DEFAULT 0 NOT NULL,
	`credit_limit_minor` integer,
	`ref_credit_limit_minor` integer,
	`status` text DEFAULT 'active' NOT NULL,
	`exclude_from_stats` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`logo_domain` text,
	`logo_initials` text(4),
	`logo_color` text(7),
	`note` text(500),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "accounts_category_check" CHECK("accounts"."category" in ('general', 'cash', 'current', 'credit_card', 'savings', 'investment', 'loan', 'other')),
	CONSTRAINT "accounts_status_check" CHECK("accounts"."status" in ('active', 'archived')),
	CONSTRAINT "accounts_position_check" CHECK("accounts"."position" >= 0),
	CONSTRAINT "accounts_credit_limit_minor_check" CHECK("accounts"."credit_limit_minor" is null or "accounts"."credit_limit_minor" >= 0),
	CONSTRAINT "accounts_ref_credit_limit_minor_check" CHECK("accounts"."ref_credit_limit_minor" is null or "accounts"."ref_credit_limit_minor" >= 0),
	CONSTRAINT "accounts_credit_limit_pair_check" CHECK(("accounts"."credit_limit_minor" is null) = ("accounts"."ref_credit_limit_minor" is null)),
	CONSTRAINT "accounts_logo_color_check" CHECK(length("accounts"."logo_color") = 7),
	CONSTRAINT "accounts_note_check" CHECK(length("accounts"."note") <= 500)
);
--> statement-breakpoint
CREATE INDEX `accounts_organization_id_position_idx` ON `accounts` (`organization_id`,`position`);--> statement-breakpoint
CREATE INDEX `accounts_organization_id_status_idx` ON `accounts` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `accounts_organization_id_currency_code_idx` ON `accounts` (`organization_id`,`currency_code`);--> statement-breakpoint
CREATE TABLE `attachments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`r2_key` text NOT NULL,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`original_name` text(255) NOT NULL,
	`uploaded_by_user_id` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`uploaded_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "attachments_byte_size_check" CHECK("attachments"."byte_size" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attachments_r2_key_unique` ON `attachments` (`r2_key`);--> statement-breakpoint
CREATE INDEX `attachments_organization_id_transaction_id_idx` ON `attachments` (`organization_id`,`transaction_id`);--> statement-breakpoint
CREATE INDEX `attachments_organization_id_created_at_idx` ON `attachments` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `brand_logos` (
	`domain` text PRIMARY KEY NOT NULL,
	`initials` text(4),
	`color` text(7),
	`fetched_at` integer NOT NULL,
	CONSTRAINT "brand_logos_color_check" CHECK(length("brand_logos"."color") = 7)
);
--> statement-breakpoint
CREATE INDEX `brand_logos_fetched_at_idx` ON `brand_logos` (`fetched_at`);--> statement-breakpoint
CREATE TABLE `budget_categories` (
	`organization_id` text NOT NULL,
	`budget_id` text NOT NULL,
	`category_id` text NOT NULL,
	PRIMARY KEY(`budget_id`, `category_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `budget_categories_organization_id_category_id_idx` ON `budget_categories` (`organization_id`,`category_id`);--> statement-breakpoint
CREATE TABLE `budget_periods` (
	`organization_id` text NOT NULL,
	`budget_id` text NOT NULL,
	`period_start` text(10) NOT NULL,
	`period_end` text(10) NOT NULL,
	`limit_minor` integer NOT NULL,
	`carried_in_minor` integer DEFAULT 0 NOT NULL,
	`spent_minor` integer DEFAULT 0 NOT NULL,
	`currency_code` text(3) NOT NULL,
	`closed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`budget_id`, `period_start`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "budget_periods_limit_minor_check" CHECK("budget_periods"."limit_minor" > 0),
	CONSTRAINT "budget_periods_range_check" CHECK("budget_periods"."period_end" >= "budget_periods"."period_start"),
	CONSTRAINT "budget_periods_period_start_check" CHECK(length("budget_periods"."period_start") = 10),
	CONSTRAINT "budget_periods_period_end_check" CHECK(length("budget_periods"."period_end") = 10)
);
--> statement-breakpoint
CREATE INDEX `budget_periods_organization_id_period_start_idx` ON `budget_periods` (`organization_id`,`period_start`);--> statement-breakpoint
CREATE TABLE `budget_transactions` (
	`organization_id` text NOT NULL,
	`budget_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`added_by_user_id` text,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`budget_id`, `transaction_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`budget_id`) REFERENCES `budgets`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `budget_transactions_organization_id_transaction_id_idx` ON `budget_transactions` (`organization_id`,`transaction_id`);--> statement-breakpoint
CREATE TABLE `budgets` (
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
	CONSTRAINT "budgets_kind_check" CHECK("budgets"."kind" in ('manual', 'category')),
	CONSTRAINT "budgets_status_check" CHECK("budgets"."status" in ('active', 'closed', 'archived')),
	CONSTRAINT "budgets_period_check" CHECK("budgets"."period" in ('one_off', 'monthly', 'quarterly', 'yearly')),
	CONSTRAINT "budgets_rollover_policy_check" CHECK("budgets"."rollover_policy" in ('none', 'carry_surplus', 'carry_all')),
	CONSTRAINT "budgets_limit_minor_check" CHECK("budgets"."limit_minor" > 0),
	CONSTRAINT "budgets_end_date_check" CHECK("budgets"."end_date" is null or "budgets"."end_date" >= "budgets"."start_date"),
	CONSTRAINT "budgets_start_date_check" CHECK(length("budgets"."start_date") = 10),
	CONSTRAINT "budgets_end_date_length_check" CHECK(length("budgets"."end_date") = 10)
);
--> statement-breakpoint
CREATE INDEX `budgets_organization_id_status_idx` ON `budgets` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `budgets_organization_id_start_date_idx` ON `budgets` (`organization_id`,`start_date`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text(100) NOT NULL,
	`slug` text(100) NOT NULL,
	`icon` text(50),
	`color` text(7) NOT NULL,
	`kind` text DEFAULT 'expense' NOT NULL,
	`parent_id` text,
	`is_system` integer DEFAULT false NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`parent_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "categories_kind_check" CHECK("categories"."kind" in ('expense', 'income', 'both')),
	CONSTRAINT "categories_color_check" CHECK(length("categories"."color") = 7),
	CONSTRAINT "categories_position_check" CHECK("categories"."position" >= 0),
	CONSTRAINT "categories_parent_self_check" CHECK("categories"."parent_id" <> "categories"."id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_organization_id_slug_unique` ON `categories` (`organization_id`,`slug`);--> statement-breakpoint
CREATE INDEX `categories_organization_id_position_idx` ON `categories` (`organization_id`,`position`);--> statement-breakpoint
CREATE INDEX `categories_organization_id_parent_id_idx` ON `categories` (`organization_id`,`parent_id`);--> statement-breakpoint
CREATE INDEX `categories_organization_id_archived_at_idx` ON `categories` (`organization_id`,`archived_at`);--> statement-breakpoint
CREATE TABLE `export_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`format` text NOT NULL,
	`groups` text,
	`date_from` text(10),
	`date_to` text(10),
	`status` text DEFAULT 'queued' NOT NULL,
	`r2_key` text,
	`byte_size` integer,
	`requested_by_user_id` text,
	`ready_at` integer,
	`expires_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`requested_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "export_jobs_format_check" CHECK("export_jobs"."format" in ('json', 'csv')),
	CONSTRAINT "export_jobs_status_check" CHECK("export_jobs"."status" in ('queued', 'running', 'ready', 'failed', 'expired')),
	CONSTRAINT "export_jobs_byte_size_check" CHECK("export_jobs"."byte_size" is null or "export_jobs"."byte_size" >= 0),
	CONSTRAINT "export_jobs_date_range_check" CHECK("export_jobs"."date_from" is null or "export_jobs"."date_to" is null or "export_jobs"."date_to" >= "export_jobs"."date_from")
);
--> statement-breakpoint
CREATE INDEX `export_jobs_organization_id_created_at_idx` ON `export_jobs` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `export_jobs_status_expires_at_idx` ON `export_jobs` (`status`,`expires_at`);--> statement-breakpoint
CREATE TABLE `import_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`source` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`file_r2_key` text,
	`row_count` integer DEFAULT 0 NOT NULL,
	`imported_count` integer DEFAULT 0 NOT NULL,
	`skipped_count` integer DEFAULT 0 NOT NULL,
	`duplicate_count` integer DEFAULT 0 NOT NULL,
	`error_count` integer DEFAULT 0 NOT NULL,
	`mapping` text,
	`started_at` integer,
	`finished_at` integer,
	`reverted_at` integer,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "import_batches_source_check" CHECK("import_batches"."source" in ('csv', 'ofx', 'qif', 'ynab', 'wallet', 'json_backup')),
	CONSTRAINT "import_batches_status_check" CHECK("import_batches"."status" in ('queued', 'parsing', 'mapping', 'previewing', 'running', 'completed', 'failed', 'reverted')),
	CONSTRAINT "import_batches_row_count_check" CHECK("import_batches"."row_count" >= 0),
	CONSTRAINT "import_batches_imported_count_check" CHECK("import_batches"."imported_count" >= 0),
	CONSTRAINT "import_batches_skipped_count_check" CHECK("import_batches"."skipped_count" >= 0),
	CONSTRAINT "import_batches_duplicate_count_check" CHECK("import_batches"."duplicate_count" >= 0),
	CONSTRAINT "import_batches_error_count_check" CHECK("import_batches"."error_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `import_batches_organization_id_created_at_idx` ON `import_batches` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `import_batches_organization_id_status_idx` ON `import_batches` (`organization_id`,`status`);--> statement-breakpoint
CREATE TABLE `import_mapping_presets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`fingerprint` text NOT NULL,
	`mapping` text NOT NULL,
	`label` text(200),
	`last_used_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `import_mapping_presets_organization_id_fingerprint_unique` ON `import_mapping_presets` (`organization_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `import_mapping_presets_organization_id_last_used_at_idx` ON `import_mapping_presets` (`organization_id`,`last_used_at`);--> statement-breakpoint
CREATE TABLE `import_row_errors` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`batch_id` text NOT NULL,
	`row_index` integer NOT NULL,
	`code` text(100) NOT NULL,
	`message` text(500),
	`raw` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "import_row_errors_row_index_check" CHECK("import_row_errors"."row_index" >= 0)
);
--> statement-breakpoint
CREATE INDEX `import_row_errors_organization_id_batch_id_row_index_idx` ON `import_row_errors` (`organization_id`,`batch_id`,`row_index`);--> statement-breakpoint
CREATE TABLE `organization_currencies` (
	`organization_id` text NOT NULL,
	`currency_code` text(3) NOT NULL,
	`is_base` integer DEFAULT false NOT NULL,
	`live_rate_update` integer DEFAULT true NOT NULL,
	`added_at` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `currency_code`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_currencies_one_base_per_org_unique` ON `organization_currencies` (`organization_id`) WHERE "organization_currencies"."is_base" = 1;--> statement-breakpoint
CREATE TABLE `organization_exchange_rates` (
	`organization_id` text NOT NULL,
	`base_code` text(3) NOT NULL,
	`quote_code` text(3) NOT NULL,
	`effective_from` text(10) NOT NULL,
	`effective_to` text(10),
	`rate_e10` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`organization_id`, `base_code`, `quote_code`, `effective_from`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`base_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`quote_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "organization_exchange_rates_rate_e10_check" CHECK("organization_exchange_rates"."rate_e10" > 0),
	CONSTRAINT "organization_exchange_rates_pair_check" CHECK("organization_exchange_rates"."base_code" <> "organization_exchange_rates"."quote_code"),
	CONSTRAINT "organization_exchange_rates_range_check" CHECK("organization_exchange_rates"."effective_to" is null or "organization_exchange_rates"."effective_to" >= "organization_exchange_rates"."effective_from"),
	CONSTRAINT "organization_exchange_rates_effective_from_check" CHECK(length("organization_exchange_rates"."effective_from") = 10),
	CONSTRAINT "organization_exchange_rates_effective_to_check" CHECK(length("organization_exchange_rates"."effective_to") = 10)
);
--> statement-breakpoint
CREATE INDEX `organization_exchange_rates_lookup_idx` ON `organization_exchange_rates` (`organization_id`,`quote_code`,`effective_from`);--> statement-breakpoint
CREATE TABLE `payee_aliases` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`payee_id` text NOT NULL,
	`normalized_name` text(200) NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payee_id`) REFERENCES `payees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payee_aliases_organization_id_normalized_name_unique` ON `payee_aliases` (`organization_id`,`normalized_name`);--> statement-breakpoint
CREATE INDEX `payee_aliases_organization_id_payee_id_idx` ON `payee_aliases` (`organization_id`,`payee_id`);--> statement-breakpoint
CREATE TABLE `payee_ignored_names` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`normalized_name` text(200) NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payee_ignored_names_organization_id_name_unique` ON `payee_ignored_names` (`organization_id`,`normalized_name`);--> statement-breakpoint
CREATE TABLE `payee_tags` (
	`organization_id` text NOT NULL,
	`payee_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`payee_id`, `tag_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payee_id`) REFERENCES `payees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `payee_tags_organization_id_tag_id_idx` ON `payee_tags` (`organization_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `payees` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text(200) NOT NULL,
	`default_category_id` text,
	`categorization_mode` text DEFAULT 'hint' NOT NULL,
	`logo_domain` text,
	`logo_initials` text(4),
	`logo_color` text(7),
	`logo_source` text,
	`note` text(500),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`default_category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "payees_categorization_mode_check" CHECK("payees"."categorization_mode" in ('enforce', 'hint', 'off')),
	CONSTRAINT "payees_logo_source_check" CHECK("payees"."logo_source" in ('auto', 'manual')),
	CONSTRAINT "payees_logo_color_check" CHECK(length("payees"."logo_color") = 7),
	CONSTRAINT "payees_note_check" CHECK(length("payees"."note") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payees_organization_id_name_unique` ON `payees` (`organization_id`,`name`);--> statement-breakpoint
CREATE INDEX `payees_organization_id_default_category_id_idx` ON `payees` (`organization_id`,`default_category_id`);--> statement-breakpoint
CREATE TABLE `recurring_candidates` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`confidence` integer DEFAULT 0 NOT NULL,
	`sample_transaction_ids` text NOT NULL,
	`suggested_name` text(200),
	`payee_id` text,
	`expected_amount_minor` integer,
	`expected_currency_code` text(3),
	`frequency` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`payee_id`) REFERENCES `payees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`expected_currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "recurring_candidates_status_check" CHECK("recurring_candidates"."status" in ('pending', 'accepted', 'dismissed')),
	CONSTRAINT "recurring_candidates_frequency_check" CHECK("recurring_candidates"."frequency" in ('weekly', 'biweekly', 'monthly', 'quarterly', 'semi_annual', 'annual')),
	CONSTRAINT "recurring_candidates_confidence_check" CHECK("recurring_candidates"."confidence" >= 0 and "recurring_candidates"."confidence" <= 100),
	CONSTRAINT "recurring_candidates_expected_amount_currency_check" CHECK("recurring_candidates"."expected_amount_minor" is null or "recurring_candidates"."expected_currency_code" is not null)
);
--> statement-breakpoint
CREATE INDEX `recurring_candidates_organization_id_status_confidence_idx` ON `recurring_candidates` (`organization_id`,`status`,`confidence`);--> statement-breakpoint
CREATE TABLE `recurring_links` (
	`organization_id` text NOT NULL,
	`series_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`match_source` text DEFAULT 'manual' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`series_id`, `transaction_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`series_id`) REFERENCES `recurring_series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "recurring_links_match_source_check" CHECK("recurring_links"."match_source" in ('manual', 'rule', 'auto')),
	CONSTRAINT "recurring_links_status_check" CHECK("recurring_links"."status" in ('active', 'unlinked'))
);
--> statement-breakpoint
CREATE INDEX `recurring_links_organization_id_transaction_id_idx` ON `recurring_links` (`organization_id`,`transaction_id`);--> statement-breakpoint
CREATE TABLE `recurring_periods` (
	`organization_id` text NOT NULL,
	`series_id` text NOT NULL,
	`period_start` text(10) NOT NULL,
	`due_on` text(10) NOT NULL,
	`status` text DEFAULT 'upcoming' NOT NULL,
	`expected_amount_minor` integer NOT NULL,
	`expected_currency_code` text(3) NOT NULL,
	`settled_transaction_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	PRIMARY KEY(`series_id`, `period_start`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`series_id`) REFERENCES `recurring_series`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`expected_currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`settled_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "recurring_periods_status_check" CHECK("recurring_periods"."status" in ('upcoming', 'paid', 'overdue', 'skipped')),
	CONSTRAINT "recurring_periods_expected_amount_minor_check" CHECK("recurring_periods"."expected_amount_minor" > 0),
	CONSTRAINT "recurring_periods_paid_requires_transaction_check" CHECK("recurring_periods"."status" <> 'paid' or "recurring_periods"."settled_transaction_id" is not null),
	CONSTRAINT "recurring_periods_period_start_check" CHECK(length("recurring_periods"."period_start") = 10),
	CONSTRAINT "recurring_periods_due_on_check" CHECK(length("recurring_periods"."due_on") = 10)
);
--> statement-breakpoint
CREATE INDEX `recurring_periods_organization_id_due_on_status_idx` ON `recurring_periods` (`organization_id`,`due_on`,`status`);--> statement-breakpoint
CREATE TABLE `recurring_series` (
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
	CONSTRAINT "recurring_series_kind_check" CHECK("recurring_series"."kind" in ('subscription', 'bill', 'installment', 'income')),
	CONSTRAINT "recurring_series_direction_check" CHECK("recurring_series"."direction" in ('income', 'expense')),
	CONSTRAINT "recurring_series_frequency_check" CHECK("recurring_series"."frequency" in ('weekly', 'biweekly', 'monthly', 'quarterly', 'semi_annual', 'annual')),
	CONSTRAINT "recurring_series_expected_amount_minor_check" CHECK("recurring_series"."expected_amount_minor" > 0),
	CONSTRAINT "recurring_series_anchor_day_check" CHECK("recurring_series"."anchor_day" is null or ("recurring_series"."anchor_day" >= 1 and "recurring_series"."anchor_day" <= 31)),
	CONSTRAINT "recurring_series_max_occurrences_check" CHECK("recurring_series"."max_occurrences" is null or "recurring_series"."max_occurrences" > 0),
	CONSTRAINT "recurring_series_end_date_check" CHECK("recurring_series"."end_date" is null or "recurring_series"."end_date" >= "recurring_series"."start_date"),
	CONSTRAINT "recurring_series_auto_record_excludes_matching_rules_check" CHECK(not ("recurring_series"."auto_record" = 1 and "recurring_series"."matching_rules" is not null)),
	CONSTRAINT "recurring_series_start_date_check" CHECK(length("recurring_series"."start_date") = 10),
	CONSTRAINT "recurring_series_end_date_length_check" CHECK(length("recurring_series"."end_date") = 10)
);
--> statement-breakpoint
CREATE INDEX `recurring_series_organization_id_is_active_idx` ON `recurring_series` (`organization_id`,`is_active`);--> statement-breakpoint
CREATE INDEX `recurring_series_organization_id_account_id_idx` ON `recurring_series` (`organization_id`,`account_id`);--> statement-breakpoint
CREATE INDEX `recurring_series_organization_id_payee_id_idx` ON `recurring_series` (`organization_id`,`payee_id`);--> statement-breakpoint
CREATE TABLE `refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`original_transaction_id` text,
	`refund_transaction_id` text NOT NULL,
	`split_id` text,
	`amount_minor` integer NOT NULL,
	`currency_code` text(3) NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`original_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`refund_transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`split_id`) REFERENCES `transaction_splits`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "refunds_amount_minor_check" CHECK("refunds"."amount_minor" > 0),
	CONSTRAINT "refunds_distinct_transactions_check" CHECK("refunds"."original_transaction_id" is null or "refunds"."original_transaction_id" <> "refunds"."refund_transaction_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `refunds_refund_transaction_id_unique` ON `refunds` (`refund_transaction_id`);--> statement-breakpoint
CREATE INDEX `refunds_organization_id_original_transaction_id_idx` ON `refunds` (`organization_id`,`original_transaction_id`);--> statement-breakpoint
CREATE INDEX `refunds_organization_id_split_id_idx` ON `refunds` (`organization_id`,`split_id`);--> statement-breakpoint
CREATE TABLE `rules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text(200) NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`match_mode` text DEFAULT 'all' NOT NULL,
	`conditions` text NOT NULL,
	`actions` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`paused_reason` text,
	`match_count` integer DEFAULT 0 NOT NULL,
	`last_matched_at` integer,
	`run_on` text DEFAULT '["manual_create","import"]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "rules_match_mode_check" CHECK("rules"."match_mode" in ('all', 'any')),
	CONSTRAINT "rules_position_check" CHECK("rules"."position" >= 0),
	CONSTRAINT "rules_match_count_check" CHECK("rules"."match_count" >= 0)
);
--> statement-breakpoint
CREATE INDEX `rules_organization_id_is_active_position_idx` ON `rules` (`organization_id`,`is_active`,`position`);--> statement-breakpoint
CREATE TABLE `savings_goal_contributions` (
	`organization_id` text NOT NULL,
	`goal_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`goal_id`, `transaction_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `savings_goal_contributions_organization_id_transaction_id_idx` ON `savings_goal_contributions` (`organization_id`,`transaction_id`);--> statement-breakpoint
CREATE TABLE `savings_goals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text(200) NOT NULL,
	`target_minor` integer NOT NULL,
	`currency_code` text(3) NOT NULL,
	`target_date` text(10),
	`account_id` text,
	`linked_account_id` text,
	`contributed_minor` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`color` text(7),
	`icon` text(50),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`linked_account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "savings_goals_status_check" CHECK("savings_goals"."status" in ('active', 'reached', 'archived')),
	CONSTRAINT "savings_goals_target_minor_check" CHECK("savings_goals"."target_minor" > 0),
	CONSTRAINT "savings_goals_contributed_minor_check" CHECK("savings_goals"."contributed_minor" >= 0),
	CONSTRAINT "savings_goals_color_check" CHECK(length("savings_goals"."color") = 7),
	CONSTRAINT "savings_goals_target_date_check" CHECK(length("savings_goals"."target_date") = 10)
);
--> statement-breakpoint
CREATE INDEX `savings_goals_organization_id_status_idx` ON `savings_goals` (`organization_id`,`status`);--> statement-breakpoint
CREATE INDEX `savings_goals_organization_id_target_date_idx` ON `savings_goals` (`organization_id`,`target_date`);--> statement-breakpoint
CREATE TABLE `suggestion_dismissals` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`kind` text NOT NULL,
	`fingerprint` text NOT NULL,
	`dismissed_at` integer NOT NULL,
	`dismissed_by_user_id` text,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`dismissed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "suggestion_dismissals_kind_check" CHECK("suggestion_dismissals"."kind" in ('transfer_pair', 'duplicate'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_dismissals_organization_id_kind_fingerprint_unique` ON `suggestion_dismissals` (`organization_id`,`kind`,`fingerprint`);--> statement-breakpoint
CREATE TABLE `tag_reminders` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`tag_id` text NOT NULL,
	`kind` text NOT NULL,
	`threshold_minor` integer,
	`currency_code` text(3),
	`frequency` text NOT NULL,
	`is_active` integer DEFAULT true NOT NULL,
	`last_notified_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tag_reminders_kind_check" CHECK("tag_reminders"."kind" in ('amount_threshold', 'absence')),
	CONSTRAINT "tag_reminders_frequency_check" CHECK("tag_reminders"."frequency" in ('daily', 'weekly', 'monthly', 'quarterly', 'yearly', 'immediate')),
	CONSTRAINT "tag_reminders_threshold_required_check" CHECK("tag_reminders"."kind" <> 'amount_threshold' or ("tag_reminders"."threshold_minor" is not null and "tag_reminders"."currency_code" is not null)),
	CONSTRAINT "tag_reminders_threshold_minor_check" CHECK("tag_reminders"."threshold_minor" is null or "tag_reminders"."threshold_minor" > 0)
);
--> statement-breakpoint
CREATE INDEX `tag_reminders_organization_id_tag_id_idx` ON `tag_reminders` (`organization_id`,`tag_id`);--> statement-breakpoint
CREATE INDEX `tag_reminders_organization_id_is_active_frequency_idx` ON `tag_reminders` (`organization_id`,`is_active`,`frequency`);--> statement-breakpoint
CREATE TABLE `tags` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text(100) NOT NULL,
	`color` text(7),
	`icon` text(50),
	`description` text(500),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tags_color_check" CHECK(length("tags"."color") = 7),
	CONSTRAINT "tags_description_check" CHECK(length("tags"."description") <= 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tags_organization_id_name_unique` ON `tags` (`organization_id`,`name`);--> statement-breakpoint
CREATE TABLE `transaction_group_items` (
	`organization_id` text NOT NULL,
	`group_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`group_id`, `transaction_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`group_id`) REFERENCES `transaction_groups`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transaction_group_items_position_check" CHECK("transaction_group_items"."position" >= 0)
);
--> statement-breakpoint
CREATE INDEX `transaction_group_items_organization_id_transaction_id_idx` ON `transaction_group_items` (`organization_id`,`transaction_id`);--> statement-breakpoint
CREATE TABLE `transaction_groups` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text(200) NOT NULL,
	`note` text(500),
	`color` text(7),
	`icon` text(50),
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "transaction_groups_color_check" CHECK(length("transaction_groups"."color") = 7),
	CONSTRAINT "transaction_groups_note_check" CHECK(length("transaction_groups"."note") <= 500)
);
--> statement-breakpoint
CREATE INDEX `transaction_groups_organization_id_created_at_idx` ON `transaction_groups` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `transaction_splits` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`category_id` text,
	`amount_minor` integer NOT NULL,
	`currency_code` text(3) NOT NULL,
	`ref_amount_minor` integer NOT NULL,
	`ref_currency_code` text(3) NOT NULL,
	`note` text(140),
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ref_currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transaction_splits_amount_minor_check" CHECK("transaction_splits"."amount_minor" > 0),
	CONSTRAINT "transaction_splits_ref_amount_minor_check" CHECK("transaction_splits"."ref_amount_minor" >= 0),
	CONSTRAINT "transaction_splits_position_check" CHECK("transaction_splits"."position" >= 0),
	CONSTRAINT "transaction_splits_note_check" CHECK(length("transaction_splits"."note") <= 140)
);
--> statement-breakpoint
CREATE INDEX `transaction_splits_organization_id_transaction_id_position_idx` ON `transaction_splits` (`organization_id`,`transaction_id`,`position`);--> statement-breakpoint
CREATE INDEX `transaction_splits_organization_id_category_id_idx` ON `transaction_splits` (`organization_id`,`category_id`);--> statement-breakpoint
CREATE TABLE `transaction_tags` (
	`organization_id` text NOT NULL,
	`transaction_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`transaction_id`, `tag_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`transaction_id`) REFERENCES `transactions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transaction_tags_organization_id_tag_id_transaction_id_idx` ON `transaction_tags` (`organization_id`,`tag_id`,`transaction_id`);--> statement-breakpoint
CREATE TABLE `transaction_template_tags` (
	`organization_id` text NOT NULL,
	`template_id` text NOT NULL,
	`tag_id` text NOT NULL,
	PRIMARY KEY(`template_id`, `tag_id`),
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`template_id`) REFERENCES `transaction_templates`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transaction_template_tags_organization_id_tag_id_idx` ON `transaction_template_tags` (`organization_id`,`tag_id`);--> statement-breakpoint
CREATE TABLE `transaction_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text(200) NOT NULL,
	`account_id` text,
	`direction` text NOT NULL,
	`amount_minor` integer,
	`currency_code` text(3),
	`category_id` text,
	`payee_id` text,
	`note` text(500),
	`payment_method` text,
	`position` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payee_id`) REFERENCES `payees`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "transaction_templates_direction_check" CHECK("transaction_templates"."direction" in ('income', 'expense')),
	CONSTRAINT "transaction_templates_payment_method_check" CHECK("transaction_templates"."payment_method" in ('cash', 'card', 'transfer', 'direct_debit', 'standing_order', 'other')),
	CONSTRAINT "transaction_templates_amount_minor_check" CHECK("transaction_templates"."amount_minor" is null or "transaction_templates"."amount_minor" > 0),
	CONSTRAINT "transaction_templates_amount_currency_pair_check" CHECK("transaction_templates"."amount_minor" is null or "transaction_templates"."currency_code" is not null),
	CONSTRAINT "transaction_templates_position_check" CHECK("transaction_templates"."position" >= 0),
	CONSTRAINT "transaction_templates_note_check" CHECK(length("transaction_templates"."note") <= 500)
);
--> statement-breakpoint
CREATE INDEX `transaction_templates_organization_id_position_idx` ON `transaction_templates` (`organization_id`,`position`);--> statement-breakpoint
CREATE TABLE `transactions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`account_id` text NOT NULL,
	`direction` text NOT NULL,
	`amount_minor` integer NOT NULL,
	`currency_code` text(3) NOT NULL,
	`ref_amount_minor` integer NOT NULL,
	`ref_currency_code` text(3) NOT NULL,
	`rate_e10` integer NOT NULL,
	`booked_on` text(10) NOT NULL,
	`booked_at` integer NOT NULL,
	`category_id` text,
	`payee_id` text,
	`payee_locked` integer DEFAULT false NOT NULL,
	`note` text(500),
	`payment_method` text,
	`transfer_kind` text DEFAULT 'none' NOT NULL,
	`transfer_id` text,
	`is_planned` integer DEFAULT false NOT NULL,
	`is_balance_adjustment` integer DEFAULT false NOT NULL,
	`refund_linked` integer DEFAULT false NOT NULL,
	`exclude_from_stats` integer DEFAULT false NOT NULL,
	`import_batch_id` text,
	`import_source_hash` text,
	`categorization_source` text,
	`recurring_series_id` text,
	`goal_id` text,
	`created_by_user_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ref_currency_code`) REFERENCES `currencies`(`code`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`payee_id`) REFERENCES `payees`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`import_batch_id`) REFERENCES `import_batches`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`recurring_series_id`) REFERENCES `recurring_series`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`goal_id`) REFERENCES `savings_goals`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`created_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "transactions_direction_check" CHECK("transactions"."direction" in ('income', 'expense')),
	CONSTRAINT "transactions_payment_method_check" CHECK("transactions"."payment_method" in ('cash', 'card', 'transfer', 'direct_debit', 'standing_order', 'other')),
	CONSTRAINT "transactions_transfer_kind_check" CHECK("transactions"."transfer_kind" in ('none', 'internal', 'external_out', 'external_in')),
	CONSTRAINT "transactions_categorization_source_check" CHECK("transactions"."categorization_source" in ('manual', 'payee_rule', 'automation', 'import_map', 'ai')),
	CONSTRAINT "transactions_amount_minor_check" CHECK("transactions"."amount_minor" > 0),
	CONSTRAINT "transactions_ref_amount_minor_check" CHECK("transactions"."ref_amount_minor" >= 0),
	CONSTRAINT "transactions_rate_e10_check" CHECK("transactions"."rate_e10" > 0),
	CONSTRAINT "transactions_booked_on_check" CHECK(length("transactions"."booked_on") = 10),
	CONSTRAINT "transactions_note_check" CHECK(length("transactions"."note") <= 500),
	CONSTRAINT "transactions_base_currency_identity_check" CHECK("transactions"."currency_code" <> "transactions"."ref_currency_code" or ("transactions"."rate_e10" = 10000000000 and "transactions"."amount_minor" = "transactions"."ref_amount_minor")),
	CONSTRAINT "transactions_transfer_id_check" CHECK(("transactions"."transfer_kind" = 'none' and "transactions"."transfer_id" is null) or ("transactions"."transfer_kind" = 'internal' and "transactions"."transfer_id" is not null) or "transactions"."transfer_kind" in ('external_out', 'external_in')),
	CONSTRAINT "transactions_adjustment_not_transfer_check" CHECK("transactions"."is_balance_adjustment" = 0 or "transactions"."transfer_kind" = 'none')
);
--> statement-breakpoint
CREATE INDEX `transactions_organization_id_booked_on_booked_at_id_idx` ON `transactions` (`organization_id`,`booked_on`,`booked_at`,`id`);--> statement-breakpoint
CREATE INDEX `transactions_organization_id_account_id_booked_on_idx` ON `transactions` (`organization_id`,`account_id`,`booked_on`);--> statement-breakpoint
CREATE INDEX `transactions_organization_id_category_id_booked_on_idx` ON `transactions` (`organization_id`,`category_id`,`booked_on`);--> statement-breakpoint
CREATE INDEX `transactions_organization_id_payee_id_booked_on_idx` ON `transactions` (`organization_id`,`payee_id`,`booked_on`);--> statement-breakpoint
CREATE INDEX `transactions_organization_id_booked_on_direction_idx` ON `transactions` (`organization_id`,`booked_on`,`direction`);--> statement-breakpoint
CREATE INDEX `transactions_organization_id_is_planned_booked_on_idx` ON `transactions` (`organization_id`,`is_planned`,`booked_on`);--> statement-breakpoint
CREATE INDEX `transactions_organization_id_transfer_id_idx` ON `transactions` (`organization_id`,`transfer_id`);--> statement-breakpoint
CREATE INDEX `transactions_organization_id_import_batch_id_idx` ON `transactions` (`organization_id`,`import_batch_id`);--> statement-breakpoint
CREATE INDEX `transactions_organization_id_import_source_hash_idx` ON `transactions` (`organization_id`,`import_source_hash`);--> statement-breakpoint
CREATE INDEX `transactions_organization_id_recurring_series_id_idx` ON `transactions` (`organization_id`,`recurring_series_id`);--> statement-breakpoint
CREATE INDEX `transactions_organization_id_goal_id_idx` ON `transactions` (`organization_id`,`goal_id`);