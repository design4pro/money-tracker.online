CREATE TABLE `agent_grants` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`name` text NOT NULL,
	`client_id` text,
	`token_hash` text,
	`token_prefix` text,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	`last_used_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_grants_kind_check" CHECK("agent_grants"."kind" in ('oauth', 'pat')),
	CONSTRAINT "agent_grants_name_length_check" CHECK(length("agent_grants"."name") <= 80),
	CONSTRAINT "agent_grants_kind_secret_check" CHECK(("agent_grants"."kind" = 'pat' and "agent_grants"."token_hash" is not null and "agent_grants"."token_prefix" is not null and "agent_grants"."client_id" is null) or ("agent_grants"."kind" = 'oauth' and "agent_grants"."token_hash" is null and "agent_grants"."token_prefix" is null))
);
--> statement-breakpoint
CREATE INDEX `agent_grants_organization_id_created_at_idx` ON `agent_grants` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_grants_organization_id_user_id_idx` ON `agent_grants` (`organization_id`,`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_grants_token_hash_unique` ON `agent_grants` (`token_hash`);--> statement-breakpoint
CREATE TABLE `agent_audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`grant_id` text NOT NULL,
	`user_id` text NOT NULL,
	`tool` text NOT NULL,
	`verb` text NOT NULL,
	`resource` text NOT NULL,
	`resource_id` text,
	`outcome` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`grant_id`) REFERENCES `agent_grants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "agent_audit_log_verb_check" CHECK("agent_audit_log"."verb" in ('read', 'write', 'delete')),
	CONSTRAINT "agent_audit_log_outcome_check" CHECK("agent_audit_log"."outcome" in ('ok', 'denied', 'not_found', 'invalid', 'rate_limited', 'error'))
);
--> statement-breakpoint
CREATE INDEX `agent_audit_log_organization_id_created_at_idx` ON `agent_audit_log` (`organization_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `agent_audit_log_organization_id_grant_id_idx` ON `agent_audit_log` (`organization_id`,`grant_id`);