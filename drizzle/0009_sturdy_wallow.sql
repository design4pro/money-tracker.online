CREATE TABLE `email_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`notification_id` text,
	`dedupe_key` text NOT NULL,
	`to_hash` text,
	`provider_message_id` text,
	`status` text NOT NULL,
	`error_code` text,
	`created_at` integer NOT NULL,
	`sent_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`notification_id`) REFERENCES `notifications`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "email_deliveries_kind_check" CHECK("email_deliveries"."kind" in ('budget.threshold_crossed', 'budget.exceeded', 'recurring.due_soon', 'recurring.overdue', 'goal.reached', 'digest')),
	CONSTRAINT "email_deliveries_status_check" CHECK("email_deliveries"."status" in ('queued', 'sending', 'sent', 'failed', 'deferred', 'digested', 'suppressed', 'bounced', 'complained'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `email_deliveries_organization_id_user_id_dedupe_key_unique` ON `email_deliveries` (`organization_id`,`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `email_deliveries_organization_id_created_at_idx` ON `email_deliveries` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `email_suppressions` (
	`email_hash` text PRIMARY KEY NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	CONSTRAINT "email_suppressions_reason_check" CHECK("email_suppressions"."reason" in ('bounced', 'complained'))
);
