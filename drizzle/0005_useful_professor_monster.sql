CREATE TABLE `notification_prefs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`in_app` integer NOT NULL,
	`email` integer NOT NULL,
	`digest` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notification_prefs_kind_check" CHECK("notification_prefs"."kind" in ('budget.threshold_crossed', 'budget.exceeded', 'recurring.due_soon', 'recurring.overdue', 'goal.reached'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_prefs_organization_id_user_id_kind_unique` ON `notification_prefs` (`organization_id`,`user_id`,`kind`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`payload_json` text NOT NULL,
	`dedupe_key` text NOT NULL,
	`read_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "notifications_kind_check" CHECK("notifications"."kind" in ('budget.threshold_crossed', 'budget.exceeded', 'recurring.due_soon', 'recurring.overdue', 'goal.reached'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_organization_id_user_id_dedupe_key_unique` ON `notifications` (`organization_id`,`user_id`,`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_organization_id_user_id_created_at_idx` ON `notifications` (`organization_id`,`user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `notifications_organization_id_user_id_read_at_idx` ON `notifications` (`organization_id`,`user_id`,`read_at`);