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