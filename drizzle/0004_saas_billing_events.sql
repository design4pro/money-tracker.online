CREATE TABLE `billing_events` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text NOT NULL,
	`organization_id` text,
	`payload_json` text NOT NULL,
	`signature_ts` integer,
	`status` text DEFAULT 'received' NOT NULL,
	`error_code` text,
	`received_at` integer NOT NULL,
	`processed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "billing_events_status_check" CHECK("billing_events"."status" in ('received', 'processed', 'ignored', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `billing_events_organization_id_idx` ON `billing_events` (`organization_id`);--> statement-breakpoint
CREATE INDEX `billing_events_status_idx` ON `billing_events` (`status`);--> statement-breakpoint
CREATE INDEX `billing_events_received_at_idx` ON `billing_events` (`received_at`);