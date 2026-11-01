CREATE TABLE `companion_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`challenge` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`redeemed_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companion_codes_code_hash_unique` ON `companion_codes` (`code_hash`);--> statement-breakpoint
CREATE INDEX `companion_codes_account_id_idx` ON `companion_codes` (`account_id`);--> statement-breakpoint
CREATE INDEX `companion_codes_expires_at_idx` ON `companion_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `companion_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`token_hash` text NOT NULL,
	`device` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	FOREIGN KEY (`account_id`) REFERENCES `accounts`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `companion_tokens_token_hash_unique` ON `companion_tokens` (`token_hash`);--> statement-breakpoint
CREATE INDEX `companion_tokens_account_id_idx` ON `companion_tokens` (`account_id`);